import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createOrganizationSchema, updateOrganizationSchema } from '@estimat/shared';

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
  fastify.post('/', { preHandler: [requireRole('admin', 'manager')] }, async (request, reply) => {
    const body = createOrganizationSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO organizations (name, inn, type, contacts, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.name, body.inn || null, body.type, JSON.stringify(body.contacts || {}), body.address || null],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/organizations/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'manager')] }, async (request, reply) => {
    const body = updateOrganizationSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.inn !== undefined) { sets.push(`inn = $${i++}`); values.push(body.inn); }
    if (body.type !== undefined) { sets.push(`type = $${i++}`); values.push(body.type); }
    if (body.contacts !== undefined) { sets.push(`contacts = $${i++}`); values.push(JSON.stringify(body.contacts)); }
    if (body.address !== undefined) { sets.push(`address = $${i++}`); values.push(body.address); }

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
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'UPDATE organizations SET is_active = false WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Организация не найдена' });
    return { success: true };
  });
}
