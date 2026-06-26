import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit, recordAuditBatch, type AuditInput } from '../../lib/audit.js';
import { makeEstimateEvent } from '../../lib/realtime/bus.js';
import { mirrorMaterialsToCatalog } from '../../lib/catalog.js';
import {
  createEstimateMaterialSchema,
  updateEstimateMaterialSchema,
  reassignMaterialsSchema,
  type EstimateChangeReason,
} from '@estimat/shared';

export default async function estimateItemsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  async function loadProjectId(db: Pick<Pool | PoolClient, 'query'>, estimateId: string): Promise<string | null> {
    const { rows } = await db.query('SELECT project_id FROM estimates WHERE id = $1', [estimateId]);
    return rows[0]?.project_id ?? null;
  }

  async function emit(
    reason: EstimateChangeReason,
    estimateId: string,
    projectId: string | null,
    actorUserId: string,
    auditLogId?: string | null,
  ): Promise<void> {
    await fastify.publishEstimateChanged(makeEstimateEvent({ estimateId, projectId, reason, actorUserId, auditLogId }));
  }

  // === Материалы (под работой) ===

  // POST /api/estimate-items/:itemId/materials — добавить материал к работе
  fastify.post<{ Params: { itemId: string } }>(
    '/:itemId/materials',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = createEstimateMaterialSchema.parse(request.body);
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: work } = await client.query('SELECT estimate_id FROM estimate_items WHERE id = $1', [request.params.itemId]);
        if (work.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Работа не найдена' });
        }
        const estimateId = work[0].estimate_id as string;
        const { rows } = await client.query(
          `INSERT INTO estimate_materials
             (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING *`,
          [
            request.params.itemId,
            estimateId,
            body.materialId ?? null,
            body.description,
            body.quantity,
            body.unit,
            body.unitPrice,
            body.sortOrder,
            body.status,
            request.currentUser.id,
          ],
        );
        const projectId = await loadProjectId(client, estimateId);
        const auditId = await recordAudit(client, {
          estimateId, projectId, entityType: 'estimate_material', entityId: rows[0].id,
          action: 'create', userId: request.currentUser.id, changes: { after: rows[0] },
        });
        await client.query('COMMIT');
        await emit('material_created', estimateId, projectId, request.currentUser.id, auditId);
        return reply.status(201).send({ data: rows[0] });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // PUT /api/estimate-items/materials/:id — обновить материал
  fastify.put<{ Params: { id: string } }>(
    '/materials/:id',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = updateEstimateMaterialSchema.parse(request.body);
      const fields: string[] = [];
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if (body.materialId !== undefined) { sets.push(`material_id = $${i++}`); values.push(body.materialId); fields.push('material_id'); }
      if (body.description !== undefined) { sets.push(`description = $${i++}`); values.push(body.description); fields.push('description'); }
      if (body.quantity !== undefined) { sets.push(`quantity = $${i++}`); values.push(body.quantity); fields.push('quantity'); }
      if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); fields.push('unit'); }
      if (body.unitPrice !== undefined) { sets.push(`unit_price = $${i++}`); values.push(body.unitPrice); fields.push('unit_price'); }
      if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); fields.push('sort_order'); }
      if (body.status !== undefined) { sets.push(`status = $${i++}`); values.push(body.status); fields.push('status'); }
      // Снятие «не согласовано»: явный needsReview либо подтверждение материала (status='confirmed').
      if (body.needsReview !== undefined) { sets.push(`needs_review = $${i++}`); values.push(body.needsReview); fields.push('needs_review'); }
      else if (body.status === 'confirmed') { sets.push('needs_review = false'); fields.push('needs_review'); }

      if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });
      sets.push(`updated_by = $${i++}`); values.push(request.currentUser.id);

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: oldRows } = await client.query('SELECT * FROM estimate_materials WHERE id = $1 FOR UPDATE', [request.params.id]);
        if (oldRows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Материал не найден' });
        }
        // OCC: материал успел изменить другой пользователь — не затираем его правки.
        if (body.expectedVersion !== undefined && oldRows[0].version !== body.expectedVersion) {
          await client.query('ROLLBACK');
          return reply.status(409).send({
            error: 'Материал изменил другой пользователь. Проверьте актуальные данные и сохраните заново.',
            code: 'CONFLICT',
            data: oldRows[0],
          });
        }
        values.push(request.params.id);
        const { rows } = await client.query(`UPDATE estimate_materials SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
        const estimateId = rows[0].estimate_id as string;
        const projectId = await loadProjectId(client, estimateId);
        // Согласование материала (клик по тегу / подтверждение «предложения») — зеркалируем в legacy-справочник.
        if ((body.status === 'confirmed' || body.needsReview === false) && rows[0].material_id === null) {
          await mirrorMaterialsToCatalog(client, [rows[0].id as string], request.currentUser.id);
        }
        const isConfirm = fields.length === 1 && fields[0] === 'needs_review';
        const auditId = await recordAudit(client, {
          estimateId, projectId, entityType: 'estimate_material', entityId: rows[0].id,
          action: isConfirm ? 'confirm' : 'update', userId: request.currentUser.id,
          changes: diffChanges(oldRows[0], rows[0], fields),
        });
        await client.query('COMMIT');
        await emit('material_updated', estimateId, projectId, request.currentUser.id, auditId);
        return { data: rows[0] };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // PATCH /api/estimate-items/materials/:id/reassign — перенести материал к другой работе.
  // Перенос между сметами запрещён (как в bulk): материал должен принадлежать той же смете,
  // что и целевая работа. Привязка — действие ревью, снимаем needs_review.
  fastify.patch<{ Params: { id: string }; Body: { itemId?: string } }>(
    '/materials/:id/reassign',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const itemId = request.body?.itemId;
      if (!itemId || typeof itemId !== 'string') {
        return reply.status(400).send({ error: 'itemId обязателен' });
      }
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: work } = await client.query('SELECT estimate_id FROM estimate_items WHERE id = $1', [itemId]);
        if (work.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Целевая работа не найдена' });
        }
        const estimateId = work[0].estimate_id as string;
        const { rows: cur } = await client.query('SELECT * FROM estimate_materials WHERE id = $1 FOR UPDATE', [request.params.id]);
        if (cur.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Материал не найден' });
        }
        if (cur[0].estimate_id !== estimateId) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Перенос материала между сметами запрещён' });
        }
        const { rows } = await client.query(
          `UPDATE estimate_materials
              SET item_id = $1, needs_review = false, updated_by = $2
            WHERE id = $3 RETURNING *`,
          [itemId, request.currentUser.id, request.params.id],
        );
        const projectId = await loadProjectId(client, estimateId);
        const auditId = await recordAudit(client, {
          estimateId, projectId, entityType: 'estimate_material', entityId: rows[0].id,
          action: 'reassign', userId: request.currentUser.id,
          changes: { oldItemId: cur[0].item_id, newItemId: itemId },
        });
        await client.query('COMMIT');
        await emit('materials_reassigned', estimateId, projectId, request.currentUser.id, auditId);
        return { data: rows[0] };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // PATCH /api/estimate-items/materials/reassign-bulk — массовый перенос материалов к одной работе.
  fastify.patch(
    '/materials/reassign-bulk',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { itemId, materialIds } = reassignMaterialsSchema.parse(request.body);

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');

        const { rows: work } = await client.query('SELECT estimate_id FROM estimate_items WHERE id = $1', [itemId]);
        if (work.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Целевая работа не найдена' });
        }
        const targetEstimateId = work[0].estimate_id as string;

        // Снимок прежней привязки до переноса (для журнала).
        const { rows: before } = await client.query(
          'SELECT id, item_id FROM estimate_materials WHERE id = ANY($1::uuid[]) AND estimate_id = $2',
          [materialIds, targetEstimateId],
        );

        // estimate_id = $2 запрещает перенос материала из другой сметы (или несуществующего)
        const { rows } = await client.query(
          `UPDATE estimate_materials
              SET item_id = $1, estimate_id = $2, needs_review = false, updated_by = $4
            WHERE id = ANY($3::uuid[]) AND estimate_id = $2
            RETURNING id`,
          [itemId, targetEstimateId, materialIds, request.currentUser.id],
        );

        if (rows.length !== materialIds.length) {
          await client.query('ROLLBACK');
          return reply
            .status(400)
            .send({ error: 'Часть материалов не найдена или относится к другой смете' });
        }

        const projectId = await loadProjectId(client, targetEstimateId);
        const oldItemById = new Map(before.map((b) => [b.id as string, b.item_id as string]));
        const audits: AuditInput[] = rows.map((r) => ({
          estimateId: targetEstimateId, projectId, entityType: 'estimate_material', entityId: r.id as string,
          action: 'reassign', userId: request.currentUser.id,
          changes: { oldItemId: oldItemById.get(r.id as string) ?? null, newItemId: itemId },
        }));
        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        await emit('materials_reassigned', targetEstimateId, projectId, request.currentUser.id);
        return { data: rows, count: rows.length };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // DELETE /api/estimate-items/materials/:id — удалить материал (snapshot в журнал)
  fastify.delete<{ Params: { id: string } }>(
    '/materials/:id',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: cur } = await client.query('SELECT * FROM estimate_materials WHERE id = $1 FOR UPDATE', [request.params.id]);
        if (cur.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Материал не найден' });
        }
        await client.query('DELETE FROM estimate_materials WHERE id = $1', [request.params.id]);
        const estimateId = cur[0].estimate_id as string;
        const projectId = await loadProjectId(client, estimateId);
        const auditId = await recordAudit(client, {
          estimateId, projectId, entityType: 'estimate_material', entityId: cur[0].id,
          action: 'delete', userId: request.currentUser.id, changes: { before: cur[0] },
        });
        await client.query('COMMIT');
        await emit('material_deleted', estimateId, projectId, request.currentUser.id, auditId);
        return { success: true };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}

// Снимок изменённых полей для журнала: before/after по затронутым колонкам.
function diffChanges(oldRow: Record<string, unknown>, newRow: Record<string, unknown>, fields: string[]) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const f of fields) {
    before[f] = oldRow[f];
    after[f] = newRow[f];
  }
  return { before, after, changedFields: fields };
}
