import type { FastifyInstance } from 'fastify';
import { createRequestCommentSchema, updateRequestCommentSchema } from '@estimat/shared';

const INTERNAL = new Set(['admin', 'engineer', 'manager']);

/** Сторона участника для адресации/непрочитанных: внутренние роли = снабжение, иначе подрядчик. */
const sideOf = (role: string) => (INTERNAL.has(role) ? 'supply' : 'contractor');

/**
 * Чат-комментарии к заявке (общение подрядчик ↔ снабжение). Доступ — как к заявке
 * (loadScoped-логика): подрядчик к своей, внутренние роли — к любой.
 * Монтируется внутри плагина /api/requests (authenticate уже навешен на плагин).
 */
export function registerRequestCommentRoutes(fastify: FastifyInstance) {
  async function access(
    requestId: string,
    user: { role: string; orgId?: string | null },
  ): Promise<'ok' | 'notfound' | 'forbidden'> {
    const { rows } = await fastify.pool.query(
      `SELECT contractor_id FROM material_requests WHERE id = $1`,
      [requestId],
    );
    if (!rows[0]) return 'notfound';
    if (INTERNAL.has(user.role)) return 'ok';
    if (user.role === 'contractor' && rows[0].contractor_id === user.orgId) return 'ok';
    return 'forbidden';
  }

  // Лента комментариев (новые сверху).
  fastify.get<{ Params: { id: string } }>('/:id/comments', async (request, reply) => {
    const acc = await access(request.params.id, request.currentUser);
    if (acc === 'notfound') return reply.status(404).send({ error: 'Заявка не найдена' });
    if (acc === 'forbidden') return reply.status(403).send({ error: 'Нет доступа' });
    const { rows } = await fastify.pool.query(
      `SELECT c.id, c.request_id, c.author_id, c.text, c.recipient, c.created_at, c.updated_at,
              u.full_name AS author_name, u.role AS author_role
         FROM material_request_comments c
         LEFT JOIN users u ON u.id = c.author_id
        WHERE c.request_id = $1
        ORDER BY c.created_at DESC`,
      [request.params.id],
    );
    return { data: rows };
  });

  // Создать комментарий.
  fastify.post<{ Params: { id: string } }>('/:id/comments', async (request, reply) => {
    const user = request.currentUser;
    const acc = await access(request.params.id, user);
    if (acc === 'notfound') return reply.status(404).send({ error: 'Заявка не найдена' });
    if (acc === 'forbidden') return reply.status(403).send({ error: 'Нет доступа' });
    const body = createRequestCommentSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO material_request_comments (request_id, author_id, text, recipient)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [request.params.id, user.id, body.text, body.recipient ?? null],
    );
    return reply.status(201).send({ data: { id: rows[0].id } });
  });

  // Правка своего комментария (или admin).
  fastify.put<{ Params: { commentId: string } }>('/comments/:commentId', async (request, reply) => {
    const user = request.currentUser;
    const body = updateRequestCommentSchema.parse(request.body);
    const cond = user.role === 'admin' ? '' : 'AND author_id = $3';
    const params: unknown[] = [request.params.commentId, body.text];
    if (user.role !== 'admin') params.push(user.id);
    const { rowCount } = await fastify.pool.query(
      `UPDATE material_request_comments SET text = $2, updated_at = now()
        WHERE id = $1 ${cond}`,
      params,
    );
    if (!rowCount) return reply.status(403).send({ error: 'Нельзя редактировать этот комментарий' });
    return { data: { ok: true } };
  });

  // Удаление своего комментария (или admin).
  fastify.delete<{ Params: { commentId: string } }>('/comments/:commentId', async (request, reply) => {
    const user = request.currentUser;
    const cond = user.role === 'admin' ? '' : 'AND author_id = $2';
    const params: unknown[] = [request.params.commentId];
    if (user.role !== 'admin') params.push(user.id);
    const { rowCount } = await fastify.pool.query(
      `DELETE FROM material_request_comments WHERE id = $1 ${cond}`,
      params,
    );
    if (!rowCount) return reply.status(403).send({ error: 'Нельзя удалить этот комментарий' });
    return { data: { ok: true } };
  });

  // Отметить комментарии заявки прочитанными.
  fastify.post<{ Params: { id: string } }>('/:id/comments/mark-read', async (request, reply) => {
    const user = request.currentUser;
    const acc = await access(request.params.id, user);
    if (acc !== 'ok') return reply.status(acc === 'notfound' ? 404 : 403).send({ error: 'Нет доступа' });
    await fastify.pool.query(
      `INSERT INTO material_request_comment_read_status (user_id, request_id, last_read_at)
       VALUES ($1,$2, now())
       ON CONFLICT (user_id, request_id) DO UPDATE SET last_read_at = now()`,
      [user.id, request.params.id],
    );
    return { data: { ok: true } };
  });

  // Счётчики непрочитанных по заявкам, доступным пользователю.
  fastify.get('/comments/unread-counts', async (request) => {
    const user = request.currentUser;
    const mySide = sideOf(user.role);
    const values: unknown[] = [user.id, mySide];
    let scope = '';
    if (!INTERNAL.has(user.role)) {
      if (!user.orgId) return { data: {} };
      values.push(user.orgId);
      scope = `AND mr.contractor_id = $${values.length}`;
    }
    const { rows } = await fastify.pool.query(
      `SELECT c.request_id, count(*)::int AS cnt
         FROM material_request_comments c
         JOIN material_requests mr ON mr.id = c.request_id
         LEFT JOIN material_request_comment_read_status rs
           ON rs.request_id = c.request_id AND rs.user_id = $1
        WHERE c.author_id <> $1
          AND (rs.last_read_at IS NULL OR c.created_at > rs.last_read_at)
          AND (c.recipient IS NULL OR c.recipient = $2)
          ${scope}
        GROUP BY c.request_id`,
      values,
    );
    const data: Record<string, number> = {};
    for (const r of rows) data[r.request_id] = Number(r.cnt);
    return { data };
  });
}
