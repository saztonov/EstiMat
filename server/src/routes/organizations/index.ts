import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createOrganizationSchema, updateOrganizationSchema, assignOrgProjectsSchema } from '@estimat/shared';

export default async function organizationRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  // GET /api/organizations
  fastify.get('/', async (request) => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM organizations ORDER BY name',
    );
    return { data: rows };
  });

  // GET /api/organizations/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM organizations WHERE id = $1',
      [request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Организация не найдена' });
    return { data: rows[0] };
  });

  // POST /api/organizations
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = createOrganizationSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO organizations (name, inn, type, contacts, address, alternative_names)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.name, body.inn || null, body.type, JSON.stringify(body.contacts || {}), body.address || null, JSON.stringify(body.alternative_names || [])],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/organizations/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = updateOrganizationSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.inn !== undefined) { sets.push(`inn = $${i++}`); values.push(body.inn); }
    if (body.type !== undefined) { sets.push(`type = $${i++}`); values.push(body.type); }
    if (body.contacts !== undefined) { sets.push(`contacts = $${i++}`); values.push(JSON.stringify(body.contacts)); }
    if (body.address !== undefined) { sets.push(`address = $${i++}`); values.push(body.address); }
    if (body.alternative_names !== undefined) { sets.push(`alternative_names = $${i++}`); values.push(JSON.stringify(body.alternative_names)); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE organizations SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Организация не найдена' });
    return { data: rows[0] };
  });

  // DELETE /api/organizations/:id
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'UPDATE organizations SET is_active = false WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Организация не найдена' });
    return { success: true };
  });

  // ============================================================
  // Объекты, назначенные организации-подрядчику (project_contractors).
  // Определяет, какие объекты видит подрядчик в личном кабинете.
  // ============================================================

  // GET /api/organizations/:id/projects — список id назначенных объектов
  fastify.get<{ Params: { id: string } }>('/:id/projects', async (request) => {
    const { rows } = await fastify.pool.query(
      'SELECT project_id FROM project_contractors WHERE contractor_id = $1',
      [request.params.id],
    );
    return { data: rows.map((r) => r.project_id as string) };
  });

  // PUT /api/organizations/:id/projects — заменить набор объектов (REPLACE)
  fastify.put<{ Params: { id: string } }>(
    '/:id/projects',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const orgId = request.params.id;
      const body = assignOrgProjectsSchema.parse(request.body);

      // Связку можно вести только для организаций-подрядчиков.
      const org = await fastify.pool.query('SELECT type FROM organizations WHERE id = $1', [orgId]);
      if (org.rows.length === 0) return reply.status(404).send({ error: 'Организация не найдена' });
      if (!['subcontractor', 'general_contractor'].includes(org.rows[0].type)) {
        return reply.status(400).send({ error: 'Объекты можно назначать только подрядчику (субподрядчик/генподрядчик)' });
      }

      const userId = request.currentUser.id;
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM project_contractors WHERE contractor_id = $1', [orgId]);
        for (const projectId of body.projectIds) {
          await client.query(
            `INSERT INTO project_contractors (project_id, contractor_id, assigned_by)
             VALUES ($1, $2, $3) ON CONFLICT (project_id, contractor_id) DO NOTHING`,
            [projectId, orgId, userId],
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return reply.send({ data: { projectIds: body.projectIds } });
    },
  );
}
