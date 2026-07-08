import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createCostCategorySchema,
  createCostTypeSchema,
  createRateSchema,
  updateRateSchema,
  updateCostCategorySchema,
  updateCostTypeSchema,
  reorderCategoriesSchema,
  reorderTypesSchema,
} from '@estimat/shared';

export default async function rateRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // === Cost Categories ===

  // GET /api/rates/categories (только активные — мягко удалённые скрыты)
  fastify.get('/categories', async () => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM cost_categories WHERE is_active ORDER BY sort_order, name',
    );
    return { data: rows };
  });

  // POST /api/rates/categories
  fastify.post('/categories', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createCostCategorySchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO cost_categories (name, code, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [body.name, body.code || null, body.sortOrder],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PATCH /api/rates/categories/reorder — нормализующая перестановка (sort_order = 0,1,2,…)
  fastify.patch('/categories/reorder', { preHandler: [requireRole('admin', 'engineer')] }, async (request) => {
    const body = reorderCategoriesSchema.parse(request.body);
    await fastify.pool.query(
      `UPDATE cost_categories c SET sort_order = t.ord - 1
       FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)
       WHERE c.id = t.id`,
      [body.ids],
    );
    return { success: true };
  });

  // PUT /api/rates/categories/:id — переименование / код / порядок
  fastify.put<{ Params: { id: string } }>('/categories/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateCostCategorySchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.code !== undefined) { sets.push(`code = $${i++}`); values.push(body.code || null); }
    if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); }
    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });
    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE cost_categories SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Категория не найдена' });
    return { data: rows[0] };
  });

  // DELETE /api/rates/categories/:id (мягкое удаление: is_active=false)
  fastify.delete<{ Params: { id: string } }>('/categories/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'UPDATE cost_categories SET is_active = false WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Категория не найдена' });
    return { success: true };
  });

  // === Cost Types ===

  // GET /api/rates/types?categoryId= (активные виды активных категорий)
  fastify.get('/types', async (request) => {
    const { categoryId } = request.query as { categoryId?: string };
    let query = `SELECT ct.* FROM cost_types ct
                 JOIN cost_categories cc ON cc.id = ct.category_id
                 WHERE ct.is_active AND cc.is_active`;
    const values: string[] = [];
    if (categoryId) {
      query += ' AND ct.category_id = $1';
      values.push(categoryId);
    }
    query += ' ORDER BY ct.sort_order, ct.name';
    const { rows } = await fastify.pool.query(query, values);
    return { data: rows };
  });

  // POST /api/rates/types
  fastify.post('/types', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createCostTypeSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO cost_types (category_id, name, code, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.categoryId, body.name, body.code || null, body.sortOrder],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PATCH /api/rates/types/reorder — перестановка видов внутри категории (sort_order = 0,1,2,…)
  fastify.patch('/types/reorder', { preHandler: [requireRole('admin', 'engineer')] }, async (request) => {
    const body = reorderTypesSchema.parse(request.body);
    await fastify.pool.query(
      `UPDATE cost_types ct SET sort_order = t.ord - 1
       FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ord)
       WHERE ct.id = t.id AND ct.category_id = $1`,
      [body.categoryId, body.ids],
    );
    return { success: true };
  });

  // PUT /api/rates/types/:id — переименование / код / порядок
  fastify.put<{ Params: { id: string } }>('/types/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateCostTypeSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.code !== undefined) { sets.push(`code = $${i++}`); values.push(body.code || null); }
    if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); }
    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });
    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE cost_types SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Вид затрат не найден' });
    return { data: rows[0] };
  });

  // DELETE /api/rates/types/:id (мягкое удаление: is_active=false)
  fastify.delete<{ Params: { id: string } }>('/types/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'UPDATE cost_types SET is_active = false WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Вид затрат не найден' });
    return { success: true };
  });

  // === Rates ===

  // Агрегат видов работы (для списка и карточки): массив cost_types + derived-поля
  // основного вида (cost_type_id/cost_type_name/category_name) для совместимости.
  // Учитываются только активные виды/категории. Виды отсортированы: основной первым.
  const RATE_TYPES_SELECT = `
    COALESCE(
      json_agg(
        json_build_object(
          'costTypeId', ct.id, 'costTypeName', ct.name,
          'categoryId', cc.id, 'categoryName', cc.name,
          'isPrimary', rct.is_primary
        ) ORDER BY rct.is_primary DESC, cc.sort_order, ct.sort_order
      ) FILTER (WHERE ct.id IS NOT NULL),
      '[]'
    ) AS cost_types,
    (array_agg(ct.id ORDER BY rct.is_primary DESC, cc.sort_order, ct.sort_order)
       FILTER (WHERE ct.id IS NOT NULL))[1] AS cost_type_id,
    (array_agg(ct.name ORDER BY rct.is_primary DESC, cc.sort_order, ct.sort_order)
       FILTER (WHERE ct.id IS NOT NULL))[1] AS cost_type_name,
    (array_agg(cc.name ORDER BY rct.is_primary DESC, cc.sort_order, ct.sort_order)
       FILTER (WHERE ct.id IS NOT NULL))[1] AS category_name`;
  const RATE_TYPES_JOIN = `
    LEFT JOIN rate_cost_types rct ON rct.rate_id = r.id
    LEFT JOIN cost_types ct ON ct.id = rct.cost_type_id AND ct.is_active
    LEFT JOIN cost_categories cc ON cc.id = ct.category_id AND cc.is_active`;

  // GET /api/rates?costTypeId=
  fastify.get('/', async (request) => {
    const { costTypeId } = request.query as { costTypeId?: string };
    const values: string[] = [];
    let where = 'WHERE r.is_active = true';
    if (costTypeId) {
      values.push(costTypeId);
      where += ` AND EXISTS (
        SELECT 1 FROM rate_cost_types x
        JOIN cost_types xt ON xt.id = x.cost_type_id AND xt.is_active
        WHERE x.rate_id = r.id AND x.cost_type_id = $1
      )`;
    }
    const { rows } = await fastify.pool.query(
      `SELECT r.*, ${RATE_TYPES_SELECT}
       FROM rates r ${RATE_TYPES_JOIN}
       ${where}
       GROUP BY r.id
       ORDER BY r.name`,
      values,
    );
    return { data: rows };
  });

  // GET /api/rates/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT r.*, ${RATE_TYPES_SELECT}
       FROM rates r ${RATE_TYPES_JOIN}
       WHERE r.id = $1
       GROUP BY r.id`,
      [request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Расценка не найдена' });
    return { data: rows[0] };
  });

  // Проверка, что все виды существуют и активны. Возвращает true/false.
  async function allTypesActive(
    client: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
    ids: string[],
  ): Promise<boolean> {
    const { rows } = await client.query(
      'SELECT id FROM cost_types WHERE id = ANY($1::uuid[]) AND is_active',
      [ids],
    );
    return rows.length === ids.length;
  }

  // POST /api/rates — создание работы + связок с видами (транзакция)
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createRateSchema.parse(request.body);
    const primaryId = body.primaryCostTypeId ?? body.costTypeIds[0];
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      if (!(await allTypesActive(client, body.costTypeIds))) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Некоторые виды работ не найдены или неактивны' });
      }
      const { rows } = await client.query(
        `INSERT INTO rates (name, code, unit, price, description)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [body.name, body.code || null, body.unit, body.price, body.description || null],
      );
      const rate = rows[0];
      for (const ctId of body.costTypeIds) {
        await client.query(
          `INSERT INTO rate_cost_types (rate_id, cost_type_id, is_primary) VALUES ($1, $2, $3)`,
          [rate.id, ctId, ctId === primaryId],
        );
      }
      await client.query('COMMIT');
      return reply.status(201).send({ data: rate });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // PUT /api/rates/:id — обновление полей и/или набора видов (транзакция)
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateRateSchema.parse(request.body);
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');

      // Скалярные поля
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
      if (body.code !== undefined) { sets.push(`code = $${i++}`); values.push(body.code); }
      if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); }
      if (body.price !== undefined) { sets.push(`price = $${i++}`); values.push(body.price); }
      if (body.description !== undefined) { sets.push(`description = $${i++}`); values.push(body.description); }

      let rate: Record<string, unknown>;
      if (sets.length > 0) {
        values.push(request.params.id);
        const { rows } = await client.query(
          `UPDATE rates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
          values,
        );
        if (rows.length === 0) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Расценка не найдена' }); }
        rate = rows[0];
      } else {
        const { rows } = await client.query('SELECT * FROM rates WHERE id = $1', [request.params.id]);
        if (rows.length === 0) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Расценка не найдена' }); }
        rate = rows[0];
      }

      if (body.costTypeIds !== undefined) {
        // Пересобрать связку целиком
        if (!(await allTypesActive(client, body.costTypeIds))) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Некоторые виды работ не найдены или неактивны' });
        }
        const primaryId = body.primaryCostTypeId ?? body.costTypeIds[0];
        await client.query('DELETE FROM rate_cost_types WHERE rate_id = $1', [request.params.id]);
        for (const ctId of body.costTypeIds) {
          await client.query(
            `INSERT INTO rate_cost_types (rate_id, cost_type_id, is_primary) VALUES ($1, $2, $3)`,
            [request.params.id, ctId, ctId === primaryId],
          );
        }
      } else if (body.primaryCostTypeId !== undefined) {
        // Сменить основной среди текущих связок
        const { rows: link } = await client.query(
          'SELECT 1 FROM rate_cost_types WHERE rate_id = $1 AND cost_type_id = $2',
          [request.params.id, body.primaryCostTypeId],
        );
        if (link.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Основной вид не связан с этой работой' });
        }
        await client.query(
          'UPDATE rate_cost_types SET is_primary = (cost_type_id = $2) WHERE rate_id = $1',
          [request.params.id, body.primaryCostTypeId],
        );
      }

      await client.query('COMMIT');
      return { data: rate };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // DELETE /api/rates/:id (мягкое удаление: is_active=false)
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'UPDATE rates SET is_active = false WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Расценка не найдена' });
    return { success: true };
  });

  // POST /api/rates/import — импорт из Excel
  fastify.post('/import', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Файл не загружен' });

    const ext = file.filename.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx') return reply.status(400).send({ error: 'Только .xlsx файлы' });

    const buffer = await file.toBuffer();
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) return reply.status(400).send({ error: 'Лист не найден в файле' });

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');

      // Load existing categories and types into cache
      const catRes = await client.query('SELECT id, name FROM cost_categories');
      const categoryCache = new Map<string, string>();
      for (const row of catRes.rows) {
        categoryCache.set((row.name as string).toLowerCase(), row.id as string);
      }

      const typeRes = await client.query('SELECT id, category_id, name FROM cost_types');
      const typeCache = new Map<string, string>();
      for (const row of typeRes.rows) {
        typeCache.set(`${row.category_id}|${(row.name as string).toLowerCase()}`, row.id as string);
      }

      let imported = 0;
      let categoriesCreated = 0;
      let typesCreated = 0;

      const rowCount = worksheet.rowCount;
      for (let r = 2; r <= rowCount; r++) {
        const row = worksheet.getRow(r);
        const categoryName = (row.getCell(1).text || '').trim();
        const typeName = (row.getCell(2).text || '').trim();
        const rateName = (row.getCell(3).text || '').trim();
        const unit = (row.getCell(4).text || '').trim();
        const priceText = (row.getCell(5).text || '').trim();

        if (!categoryName || !typeName || !rateName || !unit) continue;

        const price = parseFloat(priceText) || 0;

        // Find or create category
        let categoryId = categoryCache.get(categoryName.toLowerCase());
        if (!categoryId) {
          const res = await client.query(
            'INSERT INTO cost_categories (name) VALUES ($1) RETURNING id',
            [categoryName],
          );
          categoryId = res.rows[0].id as string;
          categoryCache.set(categoryName.toLowerCase(), categoryId);
          categoriesCreated++;
        }

        // Find or create type
        const typeKey = `${categoryId}|${typeName.toLowerCase()}`;
        let typeId = typeCache.get(typeKey);
        if (!typeId) {
          const res = await client.query(
            'INSERT INTO cost_types (category_id, name) VALUES ($1, $2) RETURNING id',
            [categoryId, typeName],
          );
          typeId = res.rows[0].id as string;
          typeCache.set(typeKey, typeId);
          typesCreated++;
        }

        // Insert rate + связь с видом (основной)
        const { rows: rateRows } = await client.query(
          'INSERT INTO rates (name, unit, price) VALUES ($1, $2, $3) RETURNING id',
          [rateName, unit, price],
        );
        await client.query(
          'INSERT INTO rate_cost_types (rate_id, cost_type_id, is_primary) VALUES ($1, $2, true)',
          [rateRows[0].id, typeId],
        );
        imported++;
      }

      await client.query('COMMIT');
      return { success: true, imported, categoriesCreated, typesCreated };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /api/rates/tree — полное дерево: категории → виды → расценки (только активные).
  // Работа под каждым своим активным видом; type_count — число активных видов работы
  // (для отображения «(N)» в дереве сметы при привязке к нескольким видам).
  fastify.get('/tree', async () => {
    const categories = await fastify.pool.query('SELECT * FROM cost_categories WHERE is_active ORDER BY sort_order, name');
    const types = await fastify.pool.query('SELECT * FROM cost_types WHERE is_active ORDER BY sort_order, name');
    const rates = await fastify.pool.query(
      `SELECT rct.cost_type_id, r.*, tc.type_count
       FROM rates r
       JOIN rate_cost_types rct ON rct.rate_id = r.id
       JOIN cost_types ct ON ct.id = rct.cost_type_id AND ct.is_active
       JOIN cost_categories cc ON cc.id = ct.category_id AND cc.is_active
       JOIN LATERAL (
         SELECT COUNT(*)::int AS type_count
         FROM rate_cost_types x
         JOIN cost_types xt ON xt.id = x.cost_type_id AND xt.is_active
         WHERE x.rate_id = r.id
       ) tc ON true
       WHERE r.is_active = true
       ORDER BY r.name`,
    );

    const tree = categories.rows.map((cat: Record<string, unknown>) => ({
      ...cat,
      types: types.rows
        .filter((t: Record<string, unknown>) => t.category_id === cat.id)
        .map((t: Record<string, unknown>) => ({
          ...t,
          rates: rates.rows.filter((r: Record<string, unknown>) => r.cost_type_id === t.id),
        })),
    }));

    return { data: tree };
  });
}
