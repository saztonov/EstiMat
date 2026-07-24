import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit } from '../../lib/audit.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId } from '../../lib/estimate-detail.js';
import { setEstimateContractorSchema } from '@estimat/shared';

// Подрядчик на вид затрат сметы (назначить/снять).
export function registerContractorRoutes(fastify: FastifyInstance): void {
  // === Подрядчик на вид затрат ===

  // PUT /api/estimates/:id/contractors — назначить/сменить подрядчика для вида затрат
  fastify.put<{ Params: { id: string } }>(
    '/:id/contractors',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const body = setEstimateContractorSchema.parse(request.body);
      const { rows } = await fastify.pool.query(
        `INSERT INTO estimate_contractors (estimate_id, cost_type_id, contractor_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (estimate_id, cost_type_id)
           DO UPDATE SET contractor_id = EXCLUDED.contractor_id, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING *`,
        [request.params.id, body.costTypeId, body.contractorId, request.currentUser.id],
      );
      const projectId = await loadProjectId(fastify.pool, request.params.id);
      const auditId = await recordAudit(fastify.pool, {
        estimateId: request.params.id,
        projectId,
        entityType: 'estimate_contractor',
        entityId: rows[0].id,
        action: 'update',
        userId: request.currentUser.id,
        changes: { after: rows[0] },
      });
      await emitEstimateChanged(fastify, 'contractor_set', request.params.id, projectId, request.currentUser.id, { auditLogId: auditId });
      return { data: rows[0] };
    },
  );

  // DELETE /api/estimates/:id/contractors?costTypeId= — снять подрядчика с вида затрат
  fastify.delete<{ Params: { id: string }; Querystring: { costTypeId?: string } }>(
    '/:id/contractors',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const { costTypeId } = request.query;
      if (!costTypeId) return reply.status(400).send({ error: 'Не указан вид затрат' });
      const { rows } = await fastify.pool.query(
        'DELETE FROM estimate_contractors WHERE estimate_id = $1 AND cost_type_id = $2 RETURNING *',
        [request.params.id, costTypeId],
      );
      if (rows.length === 0) return { success: true };
      const projectId = await loadProjectId(fastify.pool, request.params.id);
      const auditId = await recordAudit(fastify.pool, {
        estimateId: request.params.id,
        projectId,
        entityType: 'estimate_contractor',
        entityId: rows[0].id,
        action: 'delete',
        userId: request.currentUser.id,
        changes: { before: rows[0] },
      });
      await emitEstimateChanged(fastify, 'contractor_cleared', request.params.id, projectId, request.currentUser.id, { auditLogId: auditId });
      return { success: true };
    },
  );
}
