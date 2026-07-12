import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';

/**
 * Справочник поставщиков для формы «Оформить РП». Поставщики хранятся в общем справочнике
 * организаций (type='supplier'); доступен всем авторизованным (подрядчик выбирает поставщика).
 */
export default async function supplierRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  fastify.get<{ Querystring: { q?: string; limit?: string } }>('/', async (request) => {
    const q = (request.query.q ?? '').trim();
    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 50);
    const values: unknown[] = [];
    let where = `type = 'supplier' AND is_active`;
    if (q) {
      values.push(`%${q}%`);
      where += ` AND (name ILIKE $${values.length} OR inn ILIKE $${values.length})`;
    }
    values.push(limit);
    const { rows } = await fastify.pool.query(
      `SELECT id, name, inn
         FROM organizations
        WHERE ${where}
        ORDER BY name
        LIMIT $${values.length}`,
      values,
    );
    return { data: rows };
  });
}
