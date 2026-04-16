import type { FastifyInstance } from 'fastify';
import { unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createProjectSchema, updateProjectSchema } from '@estimat/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = join(__dirname, '..', '..', '..', 'uploads');

async function removeLocalUpload(url: string | null | undefined) {
  if (!url || !url.startsWith('/uploads/projects/')) return;
  const name = url.slice('/uploads/projects/'.length);
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return;
  try {
    await unlink(join(UPLOADS_ROOT, 'projects', name));
  } catch {
    // файл мог быть удалён ранее — игнорируем
  }
}

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/projects
  fastify.get('/', async () => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM projects ORDER BY code',
    );
    return { data: rows };
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
    return { data: rows };
  });

  // GET /api/projects/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });
    return { data: rows[0] };
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

    const sectionsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT s.*,
                    ct.name AS cost_type_name,
                    cc.id   AS cost_category_id,
                    cc.name AS cost_category_name,
                    o.name  AS contractor_name
               FROM estimate_sections s
               LEFT JOIN cost_types ct      ON s.cost_type_id = ct.id
               LEFT JOIN cost_categories cc ON ct.category_id = cc.id
               LEFT JOIN organizations o    ON s.contractor_id = o.id
               WHERE s.estimate_id = ANY($1)
               ORDER BY s.sort_order, s.created_at`,
            [estimateIds],
          )
        ).rows
      : [];

    const itemsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT ei.*,
                    r.name as rate_name, r.code as rate_code,
                    mc.name as material_name
               FROM estimate_items ei
               LEFT JOIN rates r ON ei.rate_id = r.id
               LEFT JOIN material_catalog mc ON ei.material_id = mc.id
               WHERE ei.estimate_id = ANY($1)
               ORDER BY ei.sort_order, ei.created_at`,
            [estimateIds],
          )
        ).rows
      : [];

    const sectionsWithItems = sectionsRows.map((s) => ({
      ...s,
      items: itemsRows.filter((i) => i.section_id === s.id),
    }));

    const estimatesWithSections = estimates.map((e) => ({
      ...e,
      sections: sectionsWithItems.filter((s) => s.estimate_id === e.id),
    }));

    const grandTotal = estimates.reduce((acc, e) => acc + Number(e.total_amount || 0), 0);

    return {
      data: {
        project: projectRows[0],
        estimates: estimatesWithSections,
        grandTotal,
      },
    };
  });

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
      await removeLocalUpload(previousImageUrl);
    }

    return { data: rows[0] };
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
