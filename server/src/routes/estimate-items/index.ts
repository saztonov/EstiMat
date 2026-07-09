import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit, recordAuditBatch, diffChanges, type AuditInput } from '../../lib/audit.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId } from '../../lib/estimate-detail.js';
import { mirrorMaterialsToCatalog } from '../../lib/catalog.js';
import {
  createEstimateMaterialSchema,
  updateEstimateMaterialSchema,
  reassignMaterialsSchema,
} from '@estimat/shared';

export default async function estimateItemsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

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
        const { rows: work } = await client.query('SELECT estimate_id, quantity FROM estimate_items WHERE id = $1', [request.params.itemId]);
        if (work.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Работа не найдена' });
        }
        const estimateId = work[0].estimate_id as string;
        // Коэффициент расхода: если задан — количество = qtyRatio × объём работы (сервер — источник
        // истины); иначе берём ручное quantity. round(…, 4) — как при автодобавлении по расценке.
        const qtyRatio = body.qtyRatio ?? null;
        const quantity = qtyRatio != null ? roundQty(qtyRatio * Number(work[0].quantity)) : body.quantity;
        const { rows } = await client.query(
          `INSERT INTO estimate_materials
             (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status, qty_ratio, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING *`,
          [
            request.params.itemId,
            estimateId,
            body.materialId ?? null,
            body.description,
            quantity,
            body.unit,
            body.unitPrice,
            body.sortOrder,
            body.status,
            qtyRatio,
            request.currentUser.id,
          ],
        );
        // Пополнение legacy-справочника: принятый ручной материал без ссылки на каталог
        // (material_id IS NULL, needs_review = false) заносится в material_catalog сразу при
        // добавлении. mirrorMaterialsToCatalog сам фильтрует по инварианту и проставляет material_id —
        // перечитываем строку, чтобы вернуть её клиенту и записать в журнал уже с привязкой.
        const catalogChanged = await mirrorMaterialsToCatalog(client, [rows[0].id as string], request.currentUser.id);
        const { rows: fresh } = await client.query('SELECT * FROM estimate_materials WHERE id = $1', [rows[0].id]);
        const material = fresh[0] ?? rows[0];
        const projectId = await loadProjectId(client, estimateId);
        const auditId = await recordAudit(client, {
          estimateId, projectId, entityType: 'estimate_material', entityId: material.id,
          action: 'create', userId: request.currentUser.id, correlationId: randomUUID(),
          changes: { after: material, undoable: true, operationKind: 'material_create' },
        });
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'material_created', estimateId, projectId, request.currentUser.id, { auditLogId: auditId });
        return reply.status(201).send({ data: material, catalogChanged });
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
      if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); fields.push('unit'); }
      if (body.unitPrice !== undefined) { sets.push(`unit_price = $${i++}`); values.push(body.unitPrice); fields.push('unit_price'); }
      if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); fields.push('sort_order'); }
      if (body.status !== undefined) { sets.push(`status = $${i++}`); values.push(body.status); fields.push('status'); }
      // Снятие «не согласовано»: явный needsReview либо подтверждение материала (status='confirmed').
      if (body.needsReview !== undefined) { sets.push(`needs_review = $${i++}`); values.push(body.needsReview); fields.push('needs_review'); }
      else if (body.status === 'confirmed') { sets.push('needs_review = false'); fields.push('needs_review'); }

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

        // Коэффициент расхода и количество (нужен объём работы — берём внутри транзакции).
        // Трогаем quantity только когда правка реально про коэф-т или количество — чтобы
        // чистое «согласование» (needsReview/status) не пересчитывало и не зашумляло журнал.
        if (body.qtyRatio !== undefined || body.quantity !== undefined) {
          // Эффективный коэф-т: новый из body или уже сохранённый. Если не NULL — quantity
          // считает сервер (qtyRatio × объём работы); иначе берём ручное quantity из body.
          const effRatio = body.qtyRatio !== undefined ? body.qtyRatio : (oldRows[0].qty_ratio as number | null);
          if (body.qtyRatio !== undefined) { sets.push(`qty_ratio = $${i++}`); values.push(body.qtyRatio); fields.push('qty_ratio'); }
          if (effRatio != null) {
            const { rows: work } = await client.query('SELECT quantity FROM estimate_items WHERE id = $1', [oldRows[0].item_id]);
            const quantity = roundQty(Number(effRatio) * Number(work[0]?.quantity ?? 0));
            sets.push(`quantity = $${i++}`); values.push(quantity); fields.push('quantity');
          } else if (body.quantity !== undefined) {
            sets.push(`quantity = $${i++}`); values.push(body.quantity); fields.push('quantity');
          }
        }

        if (fields.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Нет данных для обновления' });
        }
        sets.push(`updated_by = $${i++}`); values.push(request.currentUser.id);
        values.push(request.params.id);
        const { rows } = await client.query(`UPDATE estimate_materials SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
        const estimateId = rows[0].estimate_id as string;
        const projectId = await loadProjectId(client, estimateId);
        // Согласование материала (клик по тегу / подтверждение «предложения») — зеркалируем в legacy-справочник.
        let catalogChanged = false;
        if ((body.status === 'confirmed' || body.needsReview === false) && rows[0].material_id === null) {
          catalogChanged = await mirrorMaterialsToCatalog(client, [rows[0].id as string], request.currentUser.id);
        }
        const isConfirm = fields.length === 1 && fields[0] === 'needs_review';
        const auditId = await recordAudit(client, {
          estimateId, projectId, entityType: 'estimate_material', entityId: rows[0].id,
          action: isConfirm ? 'confirm' : 'update', userId: request.currentUser.id, correlationId: randomUUID(),
          changes: { ...diffChanges(oldRows[0], rows[0], fields), afterVersion: rows[0].version, undoable: true, operationKind: 'material_update' },
        });
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'material_updated', estimateId, projectId, request.currentUser.id, { auditLogId: auditId });
        return { data: rows[0], catalogChanged };
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
        // Перенос снимает needs_review → материал стал принятым; зеркалируем в справочник,
        // если он ещё не привязан к каталогу (mirror сам проверит инвариант).
        const catalogChanged = await mirrorMaterialsToCatalog(client, [rows[0].id as string], request.currentUser.id);
        const projectId = await loadProjectId(client, estimateId);
        const auditId = await recordAudit(client, {
          estimateId, projectId, entityType: 'estimate_material', entityId: rows[0].id,
          action: 'reassign', userId: request.currentUser.id,
          changes: { oldItemId: cur[0].item_id, newItemId: itemId },
        });
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'materials_reassigned', estimateId, projectId, request.currentUser.id, { auditLogId: auditId });
        return { data: rows[0], catalogChanged };
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

        // Перенос снимает needs_review → материалы стали принятыми; зеркалируем в справочник
        // не привязанные к каталогу (mirror сам проверит инвариант).
        const catalogChanged = await mirrorMaterialsToCatalog(client, rows.map((r) => r.id as string), request.currentUser.id);

        const projectId = await loadProjectId(client, targetEstimateId);
        const oldItemById = new Map(before.map((b) => [b.id as string, b.item_id as string]));
        const audits: AuditInput[] = rows.map((r) => ({
          estimateId: targetEstimateId, projectId, entityType: 'estimate_material', entityId: r.id as string,
          action: 'reassign', userId: request.currentUser.id,
          changes: { oldItemId: oldItemById.get(r.id as string) ?? null, newItemId: itemId },
        }));
        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'materials_reassigned', targetEstimateId, projectId, request.currentUser.id);
        return { data: rows, count: rows.length, catalogChanged };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // POST /api/estimate-items/materials/copy-bulk — массовое копирование материалов в одну работу.
  // В отличие от переноса, исходные материалы остаются на месте; создаются новые «чистые» копии:
  // material_id (ссылка на справочник) сохраняется, но qty_ratio и AI-trace сбрасываются — это новый
  // ручной материал (quantity фиксируется как видимое число, не пересчитывается от объёма целевой работы).
  fastify.post(
    '/materials/copy-bulk',
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

        // Исходные материалы той же сметы (детерминированный порядок). estimate_id = $2 запрещает
        // копирование из другой сметы. Порядок ORDER BY определяет sort_order копий в целевой работе.
        const { rows: srcRows } = await client.query(
          `SELECT * FROM estimate_materials
            WHERE id = ANY($1::uuid[]) AND estimate_id = $2
            ORDER BY item_id, sort_order, created_at, id`,
          [materialIds, targetEstimateId],
        );
        if (srcRows.length !== materialIds.length) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Часть материалов не найдена или относится к другой смете' });
        }
        if (srcRows.some((s) => s.item_id === itemId)) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Нельзя копировать материалы в ту же работу — будут дубли' });
        }

        const projectId = await loadProjectId(client, targetEstimateId);
        // sort_order дописываем в конец целевой работы (пустая работа начнётся с 0).
        const { rows: baseRows } = await client.query(
          'SELECT COALESCE(MAX(sort_order), -1) AS base FROM estimate_materials WHERE item_id = $1',
          [itemId],
        );
        let nextSort = Number(baseRows[0].base);

        const created: Record<string, unknown>[] = [];
        const audits: AuditInput[] = [];
        for (const src of srcRows) {
          nextSort += 1;
          const { rows: ins } = await client.query(
            `INSERT INTO estimate_materials
                (item_id, estimate_id, material_id, description, quantity, unit, unit_price,
                 sort_order, status, source, qty_ratio, needs_review, created_by, updated_by)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'manual', NULL, false, $9, $9)
              RETURNING *`,
            [itemId, targetEstimateId, src.material_id, src.description, src.quantity, src.unit, src.unit_price, nextSort, request.currentUser.id],
          );
          created.push(ins[0]);
          audits.push({
            estimateId: targetEstimateId, projectId, entityType: 'estimate_material', entityId: ins[0].id as string,
            action: 'create', userId: request.currentUser.id,
            changes: { after: ins[0], sourceMaterialId: src.id, sourceItemId: src.item_id, targetItemId: itemId, reason: 'copy' },
          });
        }

        await recordAuditBatch(client, audits);
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'materials_reassigned', targetEstimateId, projectId, request.currentUser.id);
        return { data: created, count: created.length };
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
          action: 'delete', userId: request.currentUser.id, correlationId: randomUUID(),
          changes: { before: cur[0], undoable: true, operationKind: 'material_delete' },
        });
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'material_deleted', estimateId, projectId, request.currentUser.id, { auditLogId: auditId });
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

// Округление количества материала до 4 знаков — как ROUND(…, 4) при автодобавлении по расценке.
function roundQty(n: number): number {
  return Math.round(n * 10000) / 10000;
}
