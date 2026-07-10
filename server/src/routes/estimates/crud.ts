import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit, diffChanges } from '../../lib/audit.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { createEstimateSchema, updateEstimateSchema } from '@estimat/shared';

// CRUD сметы (создание, правка шапки, удаление).
export function registerCrudRoutes(fastify: FastifyInstance): void {
  // POST /api/estimates
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = createEstimateSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO estimates (project_id, cost_category_id, work_type, notes, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        body.projectId,
        body.costCategoryId || null,
        body.workType || null,
        body.notes || null,
        request.currentUser.id,
      ],
    );
    const estimate = rows[0];
    await recordAudit(fastify.pool, {
      estimateId: estimate.id,
      projectId: estimate.project_id,
      entityType: 'estimate',
      entityId: estimate.id,
      action: 'create',
      userId: request.currentUser.id,
      changes: { after: estimate },
    });
    return reply.status(201).send({ data: estimate });
  });

  // PUT /api/estimates/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request, reply) => {
    const body = updateEstimateSchema.parse(request.body);
    const fields: string[] = [];
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.costCategoryId !== undefined) { sets.push(`cost_category_id = $${i++}`); values.push(body.costCategoryId); fields.push('cost_category_id'); }
    if (body.workType !== undefined) { sets.push(`work_type = $${i++}`); values.push(body.workType); fields.push('work_type'); }
    if (body.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(body.notes); fields.push('notes'); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: oldRows } = await client.query('SELECT * FROM estimates WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (oldRows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Смета не найдена' });
      }
      values.push(request.params.id);
      const { rows } = await client.query(`UPDATE estimates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
      const auditId = await recordAudit(client, {
        estimateId: request.params.id,
        projectId: rows[0].project_id,
        entityType: 'estimate',
        entityId: request.params.id,
        action: 'update',
        userId: request.currentUser.id,
        changes: diffChanges(oldRows[0], rows[0], fields),
      });
      await client.query('COMMIT');
      await emitEstimateChanged(fastify, 'estimate_updated', request.params.id, rows[0].project_id, request.currentUser.id, { auditLogId: auditId });
      return { data: rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // DELETE /api/estimates/:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole('admin', 'manager')] },
    async (request, reply) => {
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM estimates WHERE id = $1 FOR UPDATE', [request.params.id]);
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Смета не найдена' });
        }
        // Файлы-снимки ВОР этой сметы: записи снимутся каскадом при DELETE, но объекты в S3
        // нужно убрать вручную. Ключи собираем ДО удаления; сами объекты чистим после COMMIT.
        const { rows: vorFiles } = await client.query(
          'SELECT file_key FROM estimate_vors WHERE estimate_id = $1',
          [request.params.id],
        );
        if (vorFiles.length > 0 && !fastify.storage) {
          await client.query('ROLLBACK');
          return reply.status(503).send({ error: 'Хранилище файлов недоступно — удалите ВОР сметы и повторите' });
        }
        await client.query('DELETE FROM estimates WHERE id = $1', [request.params.id]);
        // estimate_id в журнале станет NULL (ON DELETE SET NULL) — project_id и snapshot переживут удаление.
        await recordAudit(client, {
          estimateId: request.params.id,
          projectId: rows[0].project_id,
          entityType: 'estimate',
          entityId: request.params.id,
          action: 'delete',
          userId: request.currentUser.id,
          changes: { before: rows[0] },
        });
        await client.query('COMMIT');
        // Осиротевшие S3-объекты ВОР — best-effort после успешного удаления (в БД их уже нет).
        if (fastify.storage) {
          for (const f of vorFiles) {
            try {
              await fastify.storage.deleteObject(f.file_key);
            } catch (delErr) {
              fastify.log.warn({ err: delErr, fileKey: f.file_key }, 'orphan cleanup after estimate delete');
            }
          }
        }
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
