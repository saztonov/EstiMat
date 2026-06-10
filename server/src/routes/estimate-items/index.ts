import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createEstimateMaterialSchema,
  updateEstimateMaterialSchema,
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
