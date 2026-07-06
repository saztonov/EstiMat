import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { requireRole } from '../../middleware/requireRole.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId } from '../../lib/estimate-detail.js';
import {
  createEstimateCommentSchema,
  updateEstimateCommentSchema,
  commentTargetTypeSchema,
} from '@estimat/shared';

// Колонка-цель по типу комментария: work → item_id, cost_type → cost_type_id.
const targetColumn = (t: 'work' | 'cost_type') => (t === 'work' ? 'item_id' : 'cost_type_id');

const listQuerySchema = z.object({
  targetType: commentTargetTypeSchema,
  targetId: z.string().uuid(),
});

// Единая проекция DTO (camelCase) с денормализованным ФИО автора.
const COMMENT_SELECT = `
  SELECT c.id,
         c.estimate_id AS "estimateId",
         CASE WHEN c.item_id IS NOT NULL THEN 'work' ELSE 'cost_type' END AS "targetType",
         COALESCE(c.item_id, c.cost_type_id) AS "targetId",
         c.body,
         c.created_by AS "createdBy",
         u.full_name  AS "createdByName",
         c.created_at AS "createdAt",
         c.updated_at AS "updatedAt"
    FROM estimate_comments c
    LEFT JOIN users u ON u.id = c.created_by`;

async function selectCommentDto(db: Pick<Pool | PoolClient, 'query'>, id: string) {
  const { rows } = await db.query(`${COMMENT_SELECT} WHERE c.id = $1`, [id]);
  return rows[0];
}

// Комментарии (примечания) к работам и видам работ в контексте сметы.
export function registerCommentRoutes(fastify: FastifyInstance): void {
  // GET /api/estimates/:id/comments?targetType=&targetId= — лента комментариев цели (newest-first).
  fastify.get<{ Params: { id: string }; Querystring: { targetType?: string; targetId?: string } }>(
    '/:id/comments',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const q = listQuerySchema.safeParse(request.query);
      if (!q.success) return reply.status(400).send({ error: 'Некорректные параметры цели' });
      const { rows } = await fastify.pool.query(
        `${COMMENT_SELECT}
          WHERE c.estimate_id = $1 AND c.${targetColumn(q.data.targetType)} = $2
          ORDER BY c.created_at DESC`,
        [request.params.id, q.data.targetId],
      );
      return { data: rows };
    },
  );

  // POST /api/estimates/:id/comments — добавить комментарий.
  fastify.post<{ Params: { id: string } }>(
    '/:id/comments',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = createEstimateCommentSchema.parse(request.body);
      const estimateId = request.params.id;

      // Проверка принадлежности цели этой смете (защита от подстановки чужих id).
      if (body.targetType === 'work') {
        const { rowCount } = await fastify.pool.query(
          'SELECT 1 FROM estimate_items WHERE id = $1 AND estimate_id = $2',
          [body.targetId, estimateId],
        );
        if (!rowCount) return reply.status(404).send({ error: 'Работа не найдена в этой смете' });
      } else {
        const { rowCount } = await fastify.pool.query(
          'SELECT 1 FROM estimate_items WHERE cost_type_id = $1 AND estimate_id = $2 LIMIT 1',
          [body.targetId, estimateId],
        );
        if (!rowCount) return reply.status(404).send({ error: 'Вид работ отсутствует в этой смете' });
      }

      const col = targetColumn(body.targetType);
      const { rows } = await fastify.pool.query(
        `INSERT INTO estimate_comments (estimate_id, ${col}, body, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [estimateId, body.targetId, body.body, request.currentUser.id],
      );
      const dto = await selectCommentDto(fastify.pool, rows[0].id);
      const projectId = await loadProjectId(fastify.pool, estimateId);
      await emitEstimateChanged(fastify, 'comment_created', estimateId, projectId, request.currentUser.id);
      return reply.status(201).send({ data: dto });
    },
  );

  // PUT /api/estimates/comments/:commentId — редактировать комментарий (автор или admin).
  fastify.put<{ Params: { commentId: string } }>(
    '/comments/:commentId',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = updateEstimateCommentSchema.parse(request.body);
      const { rows: existing } = await fastify.pool.query(
        'SELECT estimate_id, created_by FROM estimate_comments WHERE id = $1',
        [request.params.commentId],
      );
      if (existing.length === 0) return reply.status(404).send({ error: 'Комментарий не найден' });
      if (request.currentUser.role !== 'admin' && existing[0].created_by !== request.currentUser.id) {
        return reply.status(403).send({ error: 'Можно редактировать только свои комментарии' });
      }
      await fastify.pool.query('UPDATE estimate_comments SET body = $1 WHERE id = $2', [
        body.body,
        request.params.commentId,
      ]);
      const dto = await selectCommentDto(fastify.pool, request.params.commentId);
      const estimateId = existing[0].estimate_id;
      const projectId = await loadProjectId(fastify.pool, estimateId);
      await emitEstimateChanged(fastify, 'comment_updated', estimateId, projectId, request.currentUser.id);
      return { data: dto };
    },
  );

  // DELETE /api/estimates/comments/:commentId — удалить комментарий (автор или admin).
  fastify.delete<{ Params: { commentId: string } }>(
    '/comments/:commentId',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { rows: existing } = await fastify.pool.query(
        'SELECT estimate_id, created_by FROM estimate_comments WHERE id = $1',
        [request.params.commentId],
      );
      if (existing.length === 0) return reply.status(404).send({ error: 'Комментарий не найден' });
      if (request.currentUser.role !== 'admin' && existing[0].created_by !== request.currentUser.id) {
        return reply.status(403).send({ error: 'Можно удалять только свои комментарии' });
      }
      await fastify.pool.query('DELETE FROM estimate_comments WHERE id = $1', [request.params.commentId]);
      const estimateId = existing[0].estimate_id;
      const projectId = await loadProjectId(fastify.pool, estimateId);
      await emitEstimateChanged(fastify, 'comment_deleted', estimateId, projectId, request.currentUser.id);
      return { success: true };
    },
  );
}
