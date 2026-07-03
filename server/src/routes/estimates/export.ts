import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../../middleware/requireRole.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { exportEstimateKp, ExportError } from '../../lib/estimate-export/index.js';

// Экспорт сметы в Excel-шаблон «КП».
export function registerExportRoutes(fastify: FastifyInstance): void {
  // POST /api/estimates/:id/export-kp — экспорт видимых (отфильтрованных на клиенте)
  // работ в Excel-шаблон «КП». Клиент присылает набор строк [{ id, locationLabel }] в
  // порядке отображения; сервер валидирует принадлежность смете и стримит .xlsx.
  const exportKpSchema = z.object({
    items: z
      .array(z.object({ id: z.string().uuid(), locationLabel: z.string() }))
      .min(1),
    // Пропустить конфликт единиц измерения (БСМ/БСР) и всё равно собрать файл.
    ignoreUnitConflicts: z.boolean().optional(),
  });
  fastify.post<{ Params: { id: string } }>(
    '/:id/export-kp',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      try {
        await assertEstimateAccess(fastify.pool, request.params.id, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const parsed = exportKpSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Некорректный запрос экспорта' });

      try {
        const buffer = await exportEstimateKp(fastify.pool, request.params.id, parsed.data.items, {
          ignoreUnitConflicts: parsed.data.ignoreUnitConflicts,
        });
        const { rows } = await fastify.pool.query(
          `SELECT p.code AS project_code FROM estimates e
             JOIN projects p ON e.project_id = p.id WHERE e.id = $1`,
          [request.params.id],
        );
        const code = (rows[0]?.project_code as string | undefined)?.replace(/[^\w.-]+/g, '_');
        const nameRu = `КП${code ? '_' + code : ''}.xlsx`;
        reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header(
          'Content-Disposition',
          `attachment; filename="KP.xlsx"; filename*=UTF-8''${encodeURIComponent(nameRu)}`,
        );
        reply.header('X-Content-Type-Options', 'nosniff');
        return reply.send(buffer);
      } catch (err) {
        if (err instanceof ExportError)
          return reply
            .status(err.status)
            .send({ error: err.message, code: err.code, data: err.data });
        throw err;
      }
    },
  );
}
