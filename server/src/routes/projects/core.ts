import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../middleware/requireRole.js';
import { withImageSrc } from '../../lib/projectImage.js';
import { createProjectSchema, updateProjectSchema, addProjectMemberSchema } from '@estimat/shared';
import { removeUpload } from './covers.js';

// Объекты: список/галерея, карточка, создание/правка, участники.
export function registerCoreRoutes(fastify: FastifyInstance): void {
  // GET /api/projects
  // Объекты/сметы закрыты для contractor — он работает только в разделе «Подрядчики».
  fastify.get('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async () => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM projects ORDER BY code',
    );
    return { data: rows.map((r) => withImageSrc(fastify, r)) };
  });

  // GET /api/projects/with-stats — для галереи объектов на странице «Сметы»
  fastify.get('/with-stats', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async () => {
    const { rows } = await fastify.pool.query(
      `SELECT p.*,
              COALESCE(COUNT(e.id), 0)::int AS estimates_count,
              COALESCE(SUM(e.total_amount), 0)::numeric AS estimates_total,
              (SELECT COUNT(*) FROM estimate_items ei WHERE ei.project_id = p.id)::int AS works_count
         FROM projects p
         LEFT JOIN estimates e ON e.project_id = p.id
         GROUP BY p.id
         ORDER BY p.code`,
    );
    return { data: rows.map((r) => withImageSrc(fastify, r)) };
  });
  // GET /api/projects/:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const { rows } = await fastify.pool.query(
        'SELECT * FROM projects WHERE id = $1',
        [request.params.id],
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });
      return { data: withImageSrc(fastify, rows[0]) };
    },
  );

  // POST /api/projects
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO projects (code, name, full_name, address, status, start_date, end_date, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        body.code,
        body.name,
        body.fullName || null,
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
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = updateProjectSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.code !== undefined) { sets.push(`code = $${i++}`); values.push(body.code); }
    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.fullName !== undefined) { sets.push(`full_name = $${i++}`); values.push(body.fullName); }
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

    return { data: withImageSrc(fastify, rows[0]) };
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
    const { userId } = addProjectMemberSchema.parse(request.body);
    // Роль участника берём из самой учётки пользователя — клиенту тут доверять нельзя.
    const { rows: u } = await fastify.pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (u.length === 0) return reply.status(404).send({ error: 'Пользователь не найден' });
    // Дубликат участника ловит уникальный индекс → глобальный обработчик отдаёт 409.
    const { rows } = await fastify.pool.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3) RETURNING *`,
      [request.params.id, userId, u[0].role],
    );
    return reply.status(201).send({ data: rows[0] });
  });
}
