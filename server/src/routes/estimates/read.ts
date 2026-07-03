import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../middleware/requireRole.js';
import { buildEstimateDetail } from '../../lib/estimate-detail.js';

// Чтение смет: список и полная детализация (работы + материалы + подрядчики).
export function registerReadRoutes(fastify: FastifyInstance): void {
  // GET /api/estimates?projectId=
  // Закрыто для contractor: подрядчик получает свои строки только через /api/contractors/*.
  fastify.get('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async (request) => {
    const { projectId } = request.query as { projectId?: string };
    let query = `SELECT e.*,
                        p.code AS project_code,
                        p.name AS project_name,
                        cc.name AS cost_category_name
                 FROM estimates e
                 JOIN projects p ON e.project_id = p.id
                 LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id`;
    const values: string[] = [];
    if (projectId) {
      query += ' WHERE e.project_id = $1';
      values.push(projectId);
    }
    query += ' ORDER BY e.created_at DESC';
    const { rows } = await fastify.pool.query(query, values);
    return { data: rows };
  });

  // GET /api/estimates/:id — работы (с измерениями + автором), материалы (вложенно), подрядчики
  // Закрыто для contractor: отдаёт ВСЕ строки сметы; подрядчик использует /api/contractors/my-items.
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const data = await buildEstimateDetail(fastify.pool, request.params.id, {
        includeItemContractors: true,
      });
      if (data === null) return reply.status(404).send({ error: 'Смета не найдена' });
      return { data };
    },
  );

  // GET /api/estimates/:id/history — лента изменений сметы (или истории конкретной строки
}
