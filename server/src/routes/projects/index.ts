import type { FastifyInstance } from 'fastify';
import { unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createProjectSchema, updateProjectSchema } from '@estimat/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = join(__dirname, '..', '..', '..', 'uploads');

// Легаси-обложки хранились на локальном диске под /uploads/projects/<имя>.
// Новые — ключи объектов S3 (без префикса /uploads/).
function isLegacyLocalImage(value: string): boolean {
  return value.startsWith('/uploads/');
}

// Удаление прежней обложки при замене: локальный файл — unlink, объект S3 —
// deleteObject (идемпотентно, §15).
async function removeUpload(fastify: FastifyInstance, value: string | null | undefined) {
  if (!value) return;
  if (isLegacyLocalImage(value)) {
    if (!value.startsWith('/uploads/projects/')) return;
    const name = value.slice('/uploads/projects/'.length);
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return;
    try {
      await unlink(join(UPLOADS_ROOT, 'projects', name));
    } catch {
      // файл мог быть удалён ранее — игнорируем
    }
    return;
  }
  if (fastify.storage) await fastify.storage.deleteObject(value);
}

// Обложка проекта (§15): image_url в БД — ключ объекта S3 (или легаси-локальный путь).
// Для показа добавляем image_src с presigned GET-URL, не меняя сам image_url —
// чтобы round-trip формы редактирования сохранял ключ, а не протухший URL.
async function withImageSrc<T extends { image_url?: string | null }>(
  fastify: FastifyInstance,
  row: T,
): Promise<T & { image_src: string | null }> {
  const img = row.image_url ?? null;
  if (img && fastify.storage && !isLegacyLocalImage(img)) {
    try {
      return { ...row, image_src: await fastify.storage.presignGet(img) };
    } catch {
      return { ...row, image_src: null };
    }
  }
  return { ...row, image_src: img };
}

// Полная детализация сметы (как в GET /estimates/:id): работы с измерениями,
// материалы (вложенно), подрядчики по видам работ. Возвращает null, если нет.
async function buildEstimateDetail(fastify: FastifyInstance, estimateId: string) {
  const { rows } = await fastify.pool.query(
    `SELECT e.*, p.code AS project_code, p.name AS project_name, cc.name AS cost_category_name
       FROM estimates e
       JOIN projects p ON e.project_id = p.id
       LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
      WHERE e.id = $1`,
    [estimateId],
  );
  if (rows.length === 0) return null;

  const items = await fastify.pool.query(
    `SELECT ei.*, r.name AS rate_name, r.code AS rate_code,
            ct.name AS cost_type_name, cc.name AS cost_category_name
       FROM estimate_items ei
       LEFT JOIN rates r            ON ei.rate_id = r.id
       LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
      WHERE ei.estimate_id = $1
      ORDER BY cc.sort_order, ct.sort_order, ei.sort_order, ei.created_at`,
    [estimateId],
  );

  const materials = await fastify.pool.query(
    `SELECT em.*, mc.name AS material_name
       FROM estimate_materials em
       LEFT JOIN material_catalog mc ON em.material_id = mc.id
      WHERE em.estimate_id = $1
      ORDER BY em.sort_order, em.created_at`,
    [estimateId],
  );

  const contractors = await fastify.pool.query(
    `SELECT ec.cost_type_id, ec.contractor_id,
            o.name AS contractor_name, ct.name AS cost_type_name,
            cc.id AS cost_category_id, cc.name AS cost_category_name
       FROM estimate_contractors ec
       LEFT JOIN organizations o    ON ec.contractor_id = o.id
       LEFT JOIN cost_types ct      ON ec.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ct.category_id = cc.id
      WHERE ec.estimate_id = $1`,
    [estimateId],
  );

  return {
    ...rows[0],
    items: items.rows.map((it) => ({
      ...it,
      materials: materials.rows.filter((m) => m.item_id === it.id),
    })),
    contractors: contractors.rows,
  };
}

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/projects
  fastify.get('/', async () => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM projects ORDER BY code',
    );
    return { data: await Promise.all(rows.map((r) => withImageSrc(fastify, r))) };
  });

  // GET /api/projects/with-stats — для галереи объектов на странице «Сметы»
  fastify.get('/with-stats', async () => {
    const { rows } = await fastify.pool.query(
      `SELECT p.*,
              COALESCE(COUNT(e.id), 0)::int AS estimates_count,
              COALESCE(SUM(e.total_amount), 0)::numeric AS estimates_total
         FROM projects p
         LEFT JOIN estimates e ON e.project_id = p.id
         GROUP BY p.id
         ORDER BY p.code`,
    );
    return { data: await Promise.all(rows.map((r) => withImageSrc(fastify, r))) };
  });

  // GET /api/projects/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });
    return { data: await withImageSrc(fastify, rows[0]) };
  });

  // GET /api/projects/:id/summary — сводная смета по объекту
  fastify.get<{ Params: { id: string } }>('/:id/summary', async (request, reply) => {
    const { rows: projectRows } = await fastify.pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [request.params.id],
    );
    if (projectRows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });

    const { rows: estimates } = await fastify.pool.query(
      `SELECT e.id, e.work_type, e.status, e.total_amount, e.created_at,
              e.cost_category_id,
              cc.name AS cost_category_name
         FROM estimates e
         LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
         WHERE e.project_id = $1
         ORDER BY e.created_at DESC`,
      [request.params.id],
    );

    const estimateIds = estimates.map((e) => e.id);

    const itemsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT ei.*,
                    r.name  AS rate_name,
                    r.code  AS rate_code,
                    ct.name AS cost_type_name,
                    cc.name AS cost_category_name
               FROM estimate_items ei
               LEFT JOIN rates r            ON ei.rate_id = r.id
               LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
               LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
               WHERE ei.estimate_id = ANY($1)
               ORDER BY cc.sort_order, ct.sort_order, ei.sort_order, ei.created_at`,
            [estimateIds],
          )
        ).rows
      : [];

    const materialsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT em.*, mc.name AS material_name
               FROM estimate_materials em
               LEFT JOIN material_catalog mc ON em.material_id = mc.id
               WHERE em.estimate_id = ANY($1)
               ORDER BY em.sort_order, em.created_at`,
            [estimateIds],
          )
        ).rows
      : [];

    const contractorsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT ec.estimate_id, ec.cost_type_id, ec.contractor_id,
                    o.name  AS contractor_name,
                    ct.name AS cost_type_name,
                    cc.id   AS cost_category_id,
                    cc.name AS cost_category_name
               FROM estimate_contractors ec
               LEFT JOIN organizations o    ON ec.contractor_id = o.id
               LEFT JOIN cost_types ct      ON ec.cost_type_id = ct.id
               LEFT JOIN cost_categories cc ON ct.category_id = cc.id
               WHERE ec.estimate_id = ANY($1)`,
            [estimateIds],
          )
        ).rows
      : [];

    const itemsWithMaterials = itemsRows.map((it) => ({
      ...it,
      materials: materialsRows.filter((m) => m.item_id === it.id),
    }));

    const estimatesWithItems = estimates.map((e) => ({
      ...e,
      items: itemsWithMaterials.filter((it) => it.estimate_id === e.id),
      contractors: contractorsRows.filter((c) => c.estimate_id === e.id),
    }));

    const grandTotal = estimates.reduce((acc, e) => acc + Number(e.total_amount || 0), 0);

    return {
      data: {
        project: await withImageSrc(fastify, projectRows[0]),
        estimates: estimatesWithItems,
        grandTotal,
      },
    };
  });

  // GET /api/projects/:id/estimate — единая смета на объект.
  // get-or-create: если смет нет — создаём одну; если несколько — сливаем
  // позиции/материалы/подрядчиков в самую раннюю (primary), пустые удаляем.
  fastify.get<{ Params: { id: string } }>(
    '/:id/estimate',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const projectId = request.params.id;
      const { rows: projectRows } = await fastify.pool.query(
        'SELECT id FROM projects WHERE id = $1',
        [projectId],
      );
      if (projectRows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });

      const client = await fastify.pool.connect();
      let primaryId: string;
      try {
        await client.query('BEGIN');
        const { rows: ests } = await client.query(
          'SELECT id FROM estimates WHERE project_id = $1 ORDER BY created_at ASC',
          [projectId],
        );
        if (ests.length === 0) {
          const ins = await client.query(
            'INSERT INTO estimates (project_id, created_by) VALUES ($1, $2) RETURNING id',
            [projectId, request.currentUser.id],
          );
          primaryId = ins.rows[0].id as string;
        } else {
          primaryId = ests[0].id as string;
          if (ests.length > 1) {
            const others = ests.slice(1).map((e) => e.id as string);
            await client.query('UPDATE estimate_items SET estimate_id = $1 WHERE estimate_id = ANY($2)', [primaryId, others]);
            await client.query('UPDATE estimate_materials SET estimate_id = $1 WHERE estimate_id = ANY($2)', [primaryId, others]);
            await client.query(
              `INSERT INTO estimate_contractors (estimate_id, cost_type_id, contractor_id)
               SELECT $1, cost_type_id, contractor_id FROM estimate_contractors WHERE estimate_id = ANY($2)
               ON CONFLICT (estimate_id, cost_type_id) DO NOTHING`,
              [primaryId, others],
            );
            await client.query('DELETE FROM estimates WHERE id = ANY($1)', [others]);
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      const data = await buildEstimateDetail(fastify, primaryId);
      return { data };
    },
  );

  // POST /api/projects
  fastify.post('/', { preHandler: [requireRole('admin', 'manager')] }, async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO projects (code, name, full_name, org_id, address, status, start_date, end_date, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        body.code,
        body.name,
        body.fullName || null,
        body.orgId,
        body.address || null,
        body.status,
        body.startDate || null,
        body.endDate || null,
        body.imageUrl || null,
      ],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/projects/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'manager')] }, async (request, reply) => {
    const body = updateProjectSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.code !== undefined) { sets.push(`code = $${i++}`); values.push(body.code); }
    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.fullName !== undefined) { sets.push(`full_name = $${i++}`); values.push(body.fullName); }
    if (body.orgId !== undefined) { sets.push(`org_id = $${i++}`); values.push(body.orgId); }
    if (body.address !== undefined) { sets.push(`address = $${i++}`); values.push(body.address); }
    if (body.status !== undefined) { sets.push(`status = $${i++}`); values.push(body.status); }
    if (body.startDate !== undefined) { sets.push(`start_date = $${i++}`); values.push(body.startDate); }
    if (body.endDate !== undefined) { sets.push(`end_date = $${i++}`); values.push(body.endDate); }
    if (body.imageUrl !== undefined) { sets.push(`image_url = $${i++}`); values.push(body.imageUrl); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    let previousImageUrl: string | null = null;
    if (body.imageUrl !== undefined) {
      const { rows: prev } = await fastify.pool.query(
        'SELECT image_url FROM projects WHERE id = $1',
        [request.params.id],
      );
      previousImageUrl = prev[0]?.image_url ?? null;
    }

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });

    if (body.imageUrl !== undefined && previousImageUrl && previousImageUrl !== body.imageUrl) {
      await removeUpload(fastify, previousImageUrl);
    }

    return { data: await withImageSrc(fastify, rows[0]) };
  });

  // GET /api/projects/:id/members
  fastify.get<{ Params: { id: string } }>('/:id/members', async (request) => {
    const { rows } = await fastify.pool.query(
      `SELECT pm.*, u.email, u.full_name
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [request.params.id],
    );
    return { data: rows };
  });

  // POST /api/projects/:id/members
  fastify.post<{ Params: { id: string } }>('/:id/members', { preHandler: [requireRole('admin', 'manager')] }, async (request, reply) => {
    const { userId, role } = request.body as { userId: string; role: string };
    const { rows } = await fastify.pool.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3) RETURNING *`,
      [request.params.id, userId, role],
    );
    return reply.status(201).send({ data: rows[0] });
  });
}
