import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../../middleware/requireRole.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId } from '../../lib/estimate-detail.js';
import { setCostTypeCiphersSchema } from '@estimat/shared';

// Назначение шифров РД виду работ (estimate + cost_type). Набор задаётся целиком (REPLACE).
export function registerCostTypeCipherRoutes(fastify: FastifyInstance): void {
  // PUT /api/estimates/:id/cost-types/:costTypeId/ciphers — заменить набор шифров вида работ.
  fastify.put<{ Params: { id: string; costTypeId: string } }>(
    '/:id/cost-types/:costTypeId/ciphers',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const estimateId = z.string().uuid().safeParse(request.params.id);
      const costTypeId = z.string().uuid().safeParse(request.params.costTypeId);
      if (!estimateId.success || !costTypeId.success) {
        return reply.status(400).send({ error: 'Некорректный id' });
      }
      try {
        await assertEstimateAccess(fastify.pool, estimateId.data, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const body = setCostTypeCiphersSchema.parse(request.body);
      const cipherIds = [...new Set(body.cipherIds)];

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // Вид работ должен присутствовать в этой смете (есть строки с этим cost_type_id).
        const { rows: ctRows } = await client.query(
          'SELECT 1 FROM estimate_items WHERE estimate_id = $1 AND cost_type_id = $2 LIMIT 1',
          [estimateId.data, costTypeId.data],
        );
        if (ctRows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Вид работ отсутствует в смете' });
        }
        // Все шифры должны принадлежать объекту этой сметы (защита от чужих id).
        if (cipherIds.length > 0) {
          const { rows: valid } = await client.query(
            `SELECT id FROM project_rd_ciphers
              WHERE id = ANY($1::uuid[])
                AND project_id = (SELECT project_id FROM estimates WHERE id = $2)`,
            [cipherIds, estimateId.data],
          );
          if (valid.length !== cipherIds.length) {
            await client.query('ROLLBACK');
            return reply.status(400).send({ error: 'Шифр не принадлежит объекту сметы' });
          }
        }
        // REPLACE набора шифров вида работ.
        await client.query(
          'DELETE FROM estimate_cost_type_ciphers WHERE estimate_id = $1 AND cost_type_id = $2',
          [estimateId.data, costTypeId.data],
        );
        if (cipherIds.length > 0) {
          await client.query(
            `INSERT INTO estimate_cost_type_ciphers (estimate_id, cost_type_id, cipher_id)
             SELECT $1, $2, unnest($3::uuid[])`,
            [estimateId.data, costTypeId.data, cipherIds],
          );
        }
        const projectId = await loadProjectId(client, estimateId.data);
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'item_updated', estimateId.data, projectId, request.currentUser.id);
        return reply.send({ success: true });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
