import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';

// Новый справочник работ/материалов (v2), собранный из ВОР.
// Read-only: наполняется скриптом db:import-vor, редактирование пока не предусмотрено.
// Иерархия категорий/видов — общая с действующим справочником (cost_categories/cost_types).
export default async function ratesV2Routes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/rates-v2/tree — дерево: категории → виды → работы v2
  // (только категории/виды, в которых есть работы нового справочника)
  fastify.get('/tree', async () => {
    const categories = await fastify.pool.query(
      'SELECT * FROM cost_categories WHERE is_active ORDER BY sort_order, name',
    );
    const types = await fastify.pool.query('SELECT * FROM cost_types WHERE is_active ORDER BY sort_order, name');
    const rates = await fastify.pool.query(
      `SELECT rv.*, lr.name AS legacy_rate_name,
              (SELECT COUNT(*) FROM rate_materials_v2 rm WHERE rm.rate_v2_id = rv.id)::int AS materials_count
       FROM rates_v2 rv
       LEFT JOIN rates lr ON rv.legacy_rate_id = lr.id
       WHERE rv.is_active = true
       ORDER BY rv.sort_order, rv.name`,
    );

    const tree = categories.rows
      .map((cat: Record<string, unknown>) => ({
        ...cat,
        types: types.rows
          .filter((t: Record<string, unknown>) => t.category_id === cat.id)
          .map((t: Record<string, unknown>) => ({
            ...t,
            rates: rates.rows.filter((r: Record<string, unknown>) => r.cost_type_id === t.id),
          }))
          .filter((t: { rates: unknown[] }) => t.rates.length > 0),
      }))
      .filter((cat: { types: unknown[] }) => cat.types.length > 0);

    return { data: tree };
  });

  // GET /api/rates-v2/:id/materials — типовые материалы работы нового справочника
  fastify.get<{ Params: { id: string } }>('/:id/materials', async (request, reply) => {
    const { rows: work } = await fastify.pool.query('SELECT id FROM rates_v2 WHERE id = $1', [
      request.params.id,
    ]);
    if (work.length === 0) return reply.status(404).send({ error: 'Работа не найдена' });

    const { rows } = await fastify.pool.query(
      `SELECT rm.id, rm.qty_ratio, rm.files_count, rm.projects_count, rm.sort_order,
              m.id AS material_id, m.name, m.unit, m.legacy_material_id
       FROM rate_materials_v2 rm
       JOIN materials_v2 m ON m.id = rm.material_v2_id
       WHERE rm.rate_v2_id = $1
       ORDER BY rm.sort_order, m.name`,
      [request.params.id],
    );
    return { data: rows };
  });
}
