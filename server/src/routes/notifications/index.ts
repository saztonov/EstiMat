import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';

// Уведомления пользователю (о смене статуса/доработке/оплате заявок на оплату из BillHub).
// Персистентные: создаются приёмником событий (routes/integration). Здесь — чтение и отметка.

export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET / — последние уведомления пользователя.
  fastify.get<{ Querystring: { unread?: string } }>('/', async (request) => {
    const user = request.currentUser;
    const onlyUnread = request.query.unread === 'true';
    const { rows } = await fastify.pool.query(
      `SELECT id, type, title, body, payment_request_id, is_read, created_at
         FROM notifications
        WHERE user_id = $1 ${onlyUnread ? 'AND is_read = false' : ''}
        ORDER BY created_at DESC
        LIMIT 100`,
      [user.id],
    );
    return { data: rows };
  });

  // GET /count — число непрочитанных (для бейджа).
  fastify.get('/count', async (request) => {
    const user = request.currentUser;
    const { rows } = await fastify.pool.query(
      `SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND is_read = false`,
      [user.id],
    );
    return { data: { unread: rows[0].unread } };
  });

  // POST /:id/read — отметить прочитанным.
  fastify.post<{ Params: { id: string } }>('/:id/read', async (request) => {
    const user = request.currentUser;
    await fastify.pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [request.params.id, user.id],
    );
    return { data: { ok: true } };
  });

  // POST /read-all — отметить все прочитанными.
  fastify.post('/read-all', async (request) => {
    const user = request.currentUser;
    await fastify.pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [user.id],
    );
    return { data: { ok: true } };
  });
}
