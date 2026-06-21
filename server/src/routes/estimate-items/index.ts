import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
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
      const { rows: work } = await fastify.pool.query(
        'SELECT estimate_id FROM estimate_items WHERE id = $1',
        [request.params.itemId],
      );
      if (work.length === 0) return reply.status(404).send({ error: 'Работа не найдена' });

      const body = createEstimateMaterialSchema.parse(request.body);
      const { rows } = await fastify.pool.query(
        `INSERT INTO estimate_materials
           (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          request.params.itemId,
          work[0].estimate_id,
          body.materialId ?? null,
          body.description,
          body.quantity,
          body.unit,
          body.unitPrice,
          body.sortOrder,
          body.status,
        ],
      );
      return reply.status(201).send({ data: rows[0] });
    },
  );

  // PUT /api/estimate-items/materials/:id — обновить материал
  fastify.put<{ Params: { id: string } }>(
    '/materials/:id',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = updateEstimateMaterialSchema.parse(request.body);
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if (body.materialId !== undefined) { sets.push(`material_id = $${i++}`); values.push(body.materialId); }
      if (body.description !== undefined) { sets.push(`description = $${i++}`); values.push(body.description); }
      if (body.quantity !== undefined) { sets.push(`quantity = $${i++}`); values.push(body.quantity); }
      if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); }
      if (body.unitPrice !== undefined) { sets.push(`unit_price = $${i++}`); values.push(body.unitPrice); }
      if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); }
      if (body.status !== undefined) { sets.push(`status = $${i++}`); values.push(body.status); }
      // Снятие «не согласовано»: явный needsReview либо подтверждение материала (status='confirmed').
      if (body.needsReview !== undefined) { sets.push(`needs_review = $${i++}`); values.push(body.needsReview); }
      else if (body.status === 'confirmed') { sets.push('needs_review = false'); }

      if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

      values.push(request.params.id);
      const { rows } = await fastify.pool.query(
        `UPDATE estimate_materials SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        values,
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Материал не найден' });
      return { data: rows[0] };
    },
  );

  // PATCH /api/estimate-items/materials/:id/reassign — перенести материал к другой работе.
  // Привязка материала к работе — действие ревью, поэтому снимаем needs_review.
  fastify.patch<{ Params: { id: string }; Body: { itemId?: string } }>(
    '/materials/:id/reassign',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const itemId = request.body?.itemId;
      if (!itemId || typeof itemId !== 'string') {
        return reply.status(400).send({ error: 'itemId обязателен' });
      }
      const { rows: work } = await fastify.pool.query(
        'SELECT estimate_id FROM estimate_items WHERE id = $1',
        [itemId],
      );
      if (work.length === 0) return reply.status(404).send({ error: 'Целевая работа не найдена' });

      const { rows } = await fastify.pool.query(
        `UPDATE estimate_materials
            SET item_id = $1, estimate_id = $2, needs_review = false
          WHERE id = $3 RETURNING *`,
        [itemId, work[0].estimate_id, request.params.id],
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Материал не найден' });
      return { data: rows[0] };
    },
  );

  // PATCH /api/estimate-items/materials/reassign-bulk — массовый перенос материалов к одной работе.
  // All-or-nothing в транзакции: переносим только в пределах той же сметы, что у целевой работы.
  fastify.patch(
    '/materials/reassign-bulk',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { itemId, materialIds } = reassignMaterialsSchema.parse(request.body);

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');

        const { rows: work } = await client.query(
          'SELECT estimate_id FROM estimate_items WHERE id = $1',
          [itemId],
        );
        if (work.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Целевая работа не найдена' });
        }
        const targetEstimateId = work[0].estimate_id;

        // estimate_id = $2 запрещает перенос материала из другой сметы (или несуществующего)
        const { rows } = await client.query(
          `UPDATE estimate_materials
              SET item_id = $1, estimate_id = $2, needs_review = false
            WHERE id = ANY($3::uuid[]) AND estimate_id = $2
            RETURNING id`,
          [itemId, targetEstimateId, materialIds],
        );

        if (rows.length !== materialIds.length) {
          await client.query('ROLLBACK');
          return reply
            .status(400)
            .send({ error: 'Часть материалов не найдена или относится к другой смете' });
        }

        await client.query('COMMIT');
        return { data: rows, count: rows.length };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // DELETE /api/estimate-items/materials/:id — удалить материал
  fastify.delete<{ Params: { id: string } }>(
    '/materials/:id',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { rowCount } = await fastify.pool.query(
        'DELETE FROM estimate_materials WHERE id = $1',
        [request.params.id],
      );
      if (rowCount === 0) return reply.status(404).send({ error: 'Материал не найден' });
      return { success: true };
    },
  );
}
