/**
 * Импорт каталога типовых работ/материалов, собранного агентным конвейером
 * vor-catalog из ВОР (см. .claude/skills/vor-catalog/SKILL.md), в справочники БД:
 *   - расценки (rates) — в существующие виды затрат по mapping/catalog;
 *   - материалы (material_groups, material_catalog);
 *   - связи «расценка → типовые материалы» (rate_materials, qty_ratio = медиана
 *     расхода материала на единицу работы по исходным ВОР).
 *
 * Идемпотемпотентен: повторный запуск обновляет существующие записи (поиск по
 * нормализованному имени), не создаёт дубликатов.
 *
 * Запуск (на машине с write-доступом к БД, env как у сервера):
 *   npm run db:import-vor -w server -- <путь к catalog.json> [путь к mapping.json]
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { config } from '../config.js';

interface CatalogMaterial {
  canonicalName: string;
  unit: string;
  files: number;
  ratioMedian: number;
  aliases?: { name: string; sourceFile: string }[];
}

interface CatalogWork {
  canonicalName: string;
  category: string;
  costType: string;
  unit: string;
  section?: string;
  aliases?: { name: string; sourceFile: string }[];
  materials: CatalogMaterial[];
}

interface Catalog {
  works: CatalogWork[];
}

/** Запись маппинга: типовая работа каталога ↔ существующая расценка БД. */
interface MappingEntry {
  canonicalName: string;
  rateId?: string | null;
  rateName?: string | null;
}

interface Mapping {
  matched?: MappingEntry[];
  /** Вероятные совпадения — решение за пользователем; такие работы импорт пропускает,
   *  чтобы не создать дубль существующей расценки. Решить: перенести в matched
   *  (с выбранным rateId) либо удалить из probable (тогда работа будет создана). */
  probable?: { canonicalName: string }[];
}

const norm = (s: string) =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

async function main() {
  const [catalogPath, mappingPath] = process.argv.slice(2);
  if (!catalogPath) {
    console.error('Использование: db:import-vor -- <catalog.json> [mapping.json]');
    process.exit(1);
  }

  const catalog: Catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
  const mapping: Mapping = mappingPath
    ? JSON.parse(readFileSync(mappingPath, 'utf-8'))
    : {};
  const matchedByName = new Map(
    (mapping.matched ?? [])
      .filter((m) => m.rateId)
      .map((m) => [norm(m.canonicalName), m.rateId as string]),
  );
  const probableNames = new Set((mapping.probable ?? []).map((m) => norm(m.canonicalName)));

  const client = new pg.Client({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  const stats = { ratesCreated: 0, ratesMatched: 0, groupsCreated: 0, materialsCreated: 0, materialsUpdated: 0, links: 0, skipped: [] as string[] };

  try {
    await client.query('BEGIN');

    // Справочные индексы БД: категории, виды, расценки, группы, материалы
    const cats = await client.query('SELECT id, name FROM cost_categories');
    const types = await client.query('SELECT id, category_id, name FROM cost_types');
    const rates = await client.query('SELECT id, cost_type_id, name, unit FROM rates');
    const groups = await client.query('SELECT id, name FROM material_groups');
    const mats = await client.query('SELECT id, name, unit FROM material_catalog');

    const catByName = new Map(cats.rows.map((r) => [norm(r.name), r.id]));
    const typeByName = new Map(types.rows.map((r) => [norm(r.name), r]));
    const rateByName = new Map(rates.rows.map((r) => [norm(r.name), r]));
    const groupByName = new Map(groups.rows.map((r) => [norm(r.name), r.id]));
    const matByName = new Map(mats.rows.map((r) => [norm(r.name), r]));

    for (const work of catalog.works) {
      // Вероятное совпадение с расценкой БД — ждёт решения пользователя, не импортируем
      if (probableNames.has(norm(work.canonicalName)) && !matchedByName.has(norm(work.canonicalName))) {
        stats.skipped.push(`${work.canonicalName} — ожидает решения (probable в mapping.json)`);
        continue;
      }

      // --- 1. Вид затрат: только существующие (новых видов импорт не создаёт) ---
      const type = typeByName.get(norm(work.costType));
      if (!type) {
        stats.skipped.push(`${work.canonicalName} — вид затрат не найден: ${work.costType}`);
        continue;
      }
      const expectedCatId = catByName.get(norm(work.category));
      if (expectedCatId && type.category_id !== expectedCatId) {
        stats.skipped.push(`${work.canonicalName} — вид «${work.costType}» в другой категории`);
        continue;
      }

      // --- 2. Расценка: из маппинга → по имени → создать ---
      let rateId = matchedByName.get(norm(work.canonicalName)) ?? null;
      if (rateId) {
        stats.ratesMatched++;
      } else {
        const existing = rateByName.get(norm(work.canonicalName));
        if (existing) {
          rateId = existing.id;
          stats.ratesMatched++;
        } else {
          const ins = await client.query(
            `INSERT INTO rates (cost_type_id, name, unit, price) VALUES ($1, $2, $3, 0) RETURNING id`,
            [type.id, work.canonicalName, work.unit],
          );
          rateId = ins.rows[0].id;
          rateByName.set(norm(work.canonicalName), { id: rateId, cost_type_id: type.id, name: work.canonicalName, unit: work.unit });
          stats.ratesCreated++;
        }
      }

      // --- 3. Материалы + связи rate_materials ---
      let sortOrder = 0;
      for (const m of work.materials ?? []) {
        const groupName = work.section || work.costType;
        let groupId = groupByName.get(norm(groupName));
        if (!groupId) {
          const ins = await client.query(
            `INSERT INTO material_groups (name) VALUES ($1) RETURNING id`,
            [groupName],
          );
          groupId = ins.rows[0].id;
          groupByName.set(norm(groupName), groupId);
          stats.groupsCreated++;
        }

        let mat = matByName.get(norm(m.canonicalName));
        if (!mat) {
          const ins = await client.query(
            `INSERT INTO material_catalog (name, group_id, unit) VALUES ($1, $2, $3) RETURNING id, name, unit`,
            [m.canonicalName, groupId, m.unit],
          );
          mat = ins.rows[0];
          matByName.set(norm(m.canonicalName), mat);
          stats.materialsCreated++;
        } else if (mat.unit !== m.unit) {
          stats.skipped.push(`материал «${m.canonicalName}»: ед. в БД «${mat.unit}» ≠ «${m.unit}» (оставлена БД)`);
        }

        await client.query(
          `INSERT INTO rate_materials (rate_id, material_id, qty_ratio, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (rate_id, material_id)
           DO UPDATE SET qty_ratio = EXCLUDED.qty_ratio, sort_order = EXCLUDED.sort_order`,
          [rateId, mat.id, m.ratioMedian ?? 1, sortOrder++],
        );
        stats.links++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Импорт отменён (ROLLBACK):', err);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log('Импорт завершён:');
  console.log(`  расценок создано: ${stats.ratesCreated}, использовано существующих: ${stats.ratesMatched}`);
  console.log(`  групп материалов создано: ${stats.groupsCreated}`);
  console.log(`  материалов создано: ${stats.materialsCreated}`);
  console.log(`  связей rate_materials записано: ${stats.links}`);
  if (stats.skipped.length) {
    console.log('  Пропуски/замечания:');
    for (const s of stats.skipped) console.log(`   - ${s}`);
  }
}

main();
