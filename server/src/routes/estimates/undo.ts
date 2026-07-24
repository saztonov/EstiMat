import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../middleware/requireRole.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { peekUndo, performUndo, UndoError } from '../../lib/undo.js';

// Отмена последних действий пользователя в смете (undo) поверх журнала audit_log.
export function registerUndoRoutes(fastify: FastifyInstance): void {
  // GET /api/estimates/:id/undo/peek — что отменится следующим нажатием (активность кнопки + подсказка).
  fastify.get<{ Params: { id: string } }>(
    '/:id/undo/peek',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const client = await fastify.pool.connect();
      try {
        const target = await peekUndo(client, request.params.id, request.currentUser.id);
        return reply.send({ data: { undo: target ? { available: true, ...target } : null } });
      } finally {
        client.release();
      }
    },
  );

  // POST /api/estimates/:id/undo — отменить последнее своё действие (в транзакции).
  fastify.post<{ Params: { id: string } }>(
    '/:id/undo',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const res = await performUndo(client, request.params.id, request.currentUser.id);
        await client.query('COMMIT');
        await emitEstimateChanged(
          fastify,
          'undo_applied',
          request.params.id,
          res.projectId,
          request.currentUser.id,
          { correlationId: res.correlationId },
        );
        return reply.send({
          data: { undone: true, correlationId: res.correlationId, operationKind: res.operationKind, summary: res.summary },
        });
      } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof UndoError) {
          return reply.status(err.status).send({ error: err.message, code: err.code });
        }
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
