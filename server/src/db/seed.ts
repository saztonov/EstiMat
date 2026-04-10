import pg from 'pg';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

async function seed() {
  const client = new pg.Client({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  console.log('Connected. Seeding...');

  try {
    // Organization
    const orgResult = await client.query(
      `INSERT INTO organizations (name, inn, type)
       VALUES ('ООО СтройГен', '7701234567', 'general_contractor')
       ON CONFLICT DO NOTHING
       RETURNING id`,
    );
    const orgId = orgResult.rows[0]?.id;
    if (!orgId) {
      console.log('Seed data already exists. Skipping.');
      return;
    }

    // Admin user
    const passwordHash = await bcrypt.hash('admin123', 10);
    const adminResult = await client.query(
      `INSERT INTO users (email, password_hash, full_name, org_id, role)
       VALUES ('admin@estimat.ru', $1, 'Администратор', $2, 'admin')
       RETURNING id`,
      [passwordHash, orgId],
    );
    const adminId = adminResult.rows[0].id;

    // Engineer user
    const engineerHash = await bcrypt.hash('engineer123', 10);
    await client.query(
      `INSERT INTO users (email, password_hash, full_name, org_id, role)
       VALUES ('engineer@estimat.ru', $1, 'Иванов Пётр Сергеевич', $2, 'engineer')`,
      [engineerHash, orgId],
    );

    // Subcontractor org
    const subResult = await client.query(
      `INSERT INTO organizations (name, inn, type)
       VALUES ('ООО ЭлектроМонтаж', '7709876543', 'subcontractor')
       RETURNING id`,
    );
    const subId = subResult.rows[0].id;

    // Project
    const projResult = await client.query(
      `INSERT INTO projects (code, name, full_name, org_id, status)
       VALUES ('СОБ62', 'ЖК Солнечный', 'Жилой комплекс Солнечный, корпус 2', $1, 'active')
       RETURNING id`,
      [orgId],
    );
    const projectId = projResult.rows[0].id;

    // Material groups
    const grpResult = await client.query(
      `INSERT INTO material_groups (name, code) VALUES ('Кабельная продукция', 'КП') RETURNING id`,
    );
    const groupId = grpResult.rows[0].id;

    await client.query(
      `INSERT INTO material_catalog (name, group_id, unit, description) VALUES
       ('Кабель ВВГнг 3x2.5', $1, 'м', 'Кабель силовой медный'),
       ('Кабель ВВГнг 3x1.5', $1, 'м', 'Кабель силовой медный'),
       ('Труба гофрированная ПНД 20мм', $1, 'м', 'Труба для прокладки кабеля')`,
      [groupId],
    );

    // Cost categories → types → rates
    const catResult = await client.query(
      `INSERT INTO cost_categories (name, code, sort_order) VALUES
       ('Электромонтажные работы', 'ЭМ', 1),
       ('Общестроительные работы', 'ОС', 2)
       RETURNING id, code`,
    );
    const emCatId = catResult.rows.find((r: Record<string, unknown>) => r.code === 'ЭМ')?.id;
    const osCatId = catResult.rows.find((r: Record<string, unknown>) => r.code === 'ОС')?.id;

    const typeResult = await client.query(
      `INSERT INTO cost_types (category_id, name, code, sort_order) VALUES
       ($1, 'Прокладка кабеля', 'ПК', 1),
       ($1, 'Монтаж электрооборудования', 'МЭ', 2),
       ($2, 'Кладочные работы', 'КР', 1)
       RETURNING id, code`,
      [emCatId, osCatId],
    );
    const pkTypeId = typeResult.rows.find((r: Record<string, unknown>) => r.code === 'ПК')?.id;
    const meTypeId = typeResult.rows.find((r: Record<string, unknown>) => r.code === 'МЭ')?.id;
    const krTypeId = typeResult.rows.find((r: Record<string, unknown>) => r.code === 'КР')?.id;

    await client.query(
      `INSERT INTO rates (cost_type_id, name, code, unit, price) VALUES
       ($1, 'Прокладка кабеля в гофротрубе', 'ПК-01', 'м', 150.00),
       ($1, 'Прокладка кабеля в лотке', 'ПК-02', 'м', 120.00),
       ($2, 'Монтаж автоматического выключателя', 'МЭ-01', 'шт', 350.00),
       ($3, 'Кладка кирпичная в 1 кирпич', 'КР-01', 'м3', 4500.00)`,
      [pkTypeId, meTypeId, krTypeId],
    );

    // Estimate
    await client.query(
      `INSERT INTO estimates (project_id, contractor_id, work_type, created_by, notes)
       VALUES ($1, $2, 'Электромонтажные работы', $3, 'Тестовая смета')`,
      [projectId, subId, adminId],
    );

    console.log('Seed completed successfully');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
