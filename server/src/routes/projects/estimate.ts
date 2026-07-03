import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../middleware/requireRole.js';
import { withImageSrc } from '../../lib/projectImage.js';
import { buildEstimateDetail, bucketBy, ITEMS_CANONICAL_ORDER_BY } from '../../lib/estimate-detail.js';

// Смета объекта: сводная, статистика по авторам, единая смета (get-or-create + слияние).
export function registerEstimateRoutes(fastify: FastifyInstance): void {
  // GET /api/projects/:id/summary — сводная смета по объекту
  fastify.get<{ Params: { id: string } }>(
    '/:id/summary',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
    const { rows: projectRows } = await fastify.pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [request.params.id],
    );
    if (projectRows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });

    const { rows: estimates } = await fastify.pool.query(
      `SELECT e.id, e.work_type, e.status, e.total_amount, e.created_at,
              e.cost_category_id,
              cc.name AS cost_category_name
         FROM estimates e
         LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
         WHERE e.project_id = $1
         ORDER BY e.created_at DESC`,
      [request.params.id],
    );

    const estimateIds = estimates.map((e) => e.id);

    const itemsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT ei.*,
                    r.name  AS rate_name,
                    r.code  AS rate_code,
                    ct.name AS cost_type_name,
                    cc.name AS cost_category_name,
                    z.name  AS zone_name,
                    z.kind  AS zone_kind,
                    rt.name AS room_type_name,
                    lt.name AS location_type_name
               FROM estimate_items ei
               LEFT JOIN rates r            ON ei.rate_id = r.id
               LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
               LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
               LEFT JOIN project_zones z    ON ei.zone_id = z.id
               LEFT JOIN room_types rt      ON ei.room_type_id = rt.id
               LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
               WHERE ei.estimate_id = ANY($1)
               ORDER BY ${ITEMS_CANONICAL_ORDER_BY}`,
            [estimateIds],
          )
        ).rows
      : [];

    const materialsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT em.*, mc.name AS material_name
               FROM estimate_materials em
               LEFT JOIN material_catalog mc ON em.material_id = mc.id
               WHERE em.estimate_id = ANY($1)
               ORDER BY em.sort_order, em.created_at`,
            [estimateIds],
          )
        ).rows
      : [];

    const contractorsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT ec.estimate_id, ec.cost_type_id, ec.contractor_id,
                    o.name  AS contractor_name,
                    ct.name AS cost_type_name,
                    cc.id   AS cost_category_id,
                    cc.name AS cost_category_name
               FROM estimate_contractors ec
               LEFT JOIN organizations o    ON ec.contractor_id = o.id
               LEFT JOIN cost_types ct      ON ec.cost_type_id = ct.id
               LEFT JOIN cost_categories cc ON ct.category_id = cc.id
               WHERE ec.estimate_id = ANY($1)`,
            [estimateIds],
          )
        ).rows
      : [];

    // Бакетизация за один проход вместо .filter() внутри .map() (O(n×m) → O(n+m));
    // порядок внутри бакетов задан ORDER BY соответствующих SELECT.
    const materialsByItem = bucketBy(materialsRows, (m) => m.item_id as string);
    const itemsWithMaterials = itemsRows.map((it) => ({
      ...it,
      materials: materialsByItem.get(it.id as string) ?? [],
    }));

    const itemsByEstimate = bucketBy(itemsWithMaterials, (it) => it.estimate_id as string);
    const contractorsByEstimate = bucketBy(contractorsRows, (c) => c.estimate_id as string);
    const estimatesWithItems = estimates.map((e) => ({
      ...e,
      items: itemsByEstimate.get(e.id as string) ?? [],
      contractors: contractorsByEstimate.get(e.id as string) ?? [],
    }));

    const grandTotal = estimates.reduce((acc, e) => acc + Number(e.total_amount || 0), 0);

    return {
      data: {
        project: withImageSrc(fastify, projectRows[0]),
        estimates: estimatesWithItems,
        grandTotal,
      },
    };
  });

  // GET /api/projects/:id/stats — статистика по смете объекта:
  // всего категорий/видов/наименований работ и материалов, а также разбивка
  // по авторам — сколько строк работ/материалов добавил каждый по периодам
  // (Сегодня/Вчера/Неделя/Месяц/Всего). Агрегируем по всем сметам объекта
  // через денормализованный estimate_items.project_id.
  fastify.get<{ Params: { id: string } }>(
    '/:id/stats',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const projectId = request.params.id;
      const { rows: projectRows } = await fastify.pool.query(
        'SELECT id FROM projects WHERE id = $1',
        [projectId],
      );
      if (projectRows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });

      const [worksTotal, materialsTotal, byAuthorRows] = await Promise.all([
        fastify.pool.query(
          `SELECT COUNT(DISTINCT ei.cost_category_id)::int AS categories,
                  COUNT(DISTINCT ei.cost_type_id)::int     AS types,
                  COUNT(*)::int                            AS works
             FROM estimate_items ei
            WHERE ei.project_id = $1`,
          [projectId],
        ),
        fastify.pool.query(
          `SELECT COUNT(*)::int AS materials
             FROM estimate_materials em
             JOIN estimates e ON e.id = em.estimate_id
            WHERE e.project_id = $1`,
          [projectId],
        ),
        // Разбивка по авторам: сколько строк работ/материалов добавил каждый автор
        // по периодам — скользящие накопительные окна (больший включает меньшие).
        // Границы дней считаем в московском локальном времени: created_at (UTC/tz)
        // → naive-local через AT TIME ZONE, сравнение с naive-границами консистентно.
        fastify.pool.query(
          `WITH b AS (
             SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')                     AS today_start,
                    date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') - interval '1 day'   AS yest_start,
                    date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') - interval '6 days'  AS week_start,
                    date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') - interval '29 days' AS month_start
           ),
           events AS (
             SELECT ei.created_by AS user_id, (ei.created_at AT TIME ZONE 'Europe/Moscow') AS cl, false AS is_material
               FROM estimate_items ei
              WHERE ei.project_id = $1
             UNION ALL
             SELECT em.created_by AS user_id, (em.created_at AT TIME ZONE 'Europe/Moscow') AS cl, true AS is_material
               FROM estimate_materials em
               JOIN estimates e ON e.id = em.estimate_id
              WHERE e.project_id = $1
           )
           SELECT ev.user_id, u.full_name,
             COUNT(*) FILTER (WHERE NOT ev.is_material AND ev.cl >= b.today_start)::int                          AS works_today,
             COUNT(*) FILTER (WHERE     ev.is_material AND ev.cl >= b.today_start)::int                          AS materials_today,
             COUNT(*) FILTER (WHERE NOT ev.is_material AND ev.cl >= b.yest_start AND ev.cl < b.today_start)::int AS works_yesterday,
             COUNT(*) FILTER (WHERE     ev.is_material AND ev.cl >= b.yest_start AND ev.cl < b.today_start)::int AS materials_yesterday,
             COUNT(*) FILTER (WHERE NOT ev.is_material AND ev.cl >= b.week_start)::int                           AS works_week,
             COUNT(*) FILTER (WHERE     ev.is_material AND ev.cl >= b.week_start)::int                           AS materials_week,
             COUNT(*) FILTER (WHERE NOT ev.is_material AND ev.cl >= b.month_start)::int                          AS works_month,
             COUNT(*) FILTER (WHERE     ev.is_material AND ev.cl >= b.month_start)::int                          AS materials_month,
             COUNT(*) FILTER (WHERE NOT ev.is_material)::int                                                     AS works_total,
             COUNT(*) FILTER (WHERE     ev.is_material)::int                                                     AS materials_total
             FROM events ev
             CROSS JOIN b
             LEFT JOIN users u ON u.id = ev.user_id
            GROUP BY ev.user_id, u.full_name
            ORDER BY works_total DESC, materials_total DESC`,
          [projectId],
        ),
      ]);

      // Каждая ячейка периода — пара «работы (материалы)». Legacy-строки без автора
      // (created_by = NULL) сливаются в одну группу с именем «Не указан».
      const byAuthor = byAuthorRows.rows.map((r) => ({
        userId: r.user_id,
        name: r.full_name ?? 'Не указан',
        today: { works: r.works_today, materials: r.materials_today },
        yesterday: { works: r.works_yesterday, materials: r.materials_yesterday },
        week: { works: r.works_week, materials: r.materials_week },
        month: { works: r.works_month, materials: r.materials_month },
        total: { works: r.works_total, materials: r.materials_total },
      }));

      const t = worksTotal.rows[0];
      return {
        data: {
          totals: {
            categories: t.categories,
            types: t.types,
            works: t.works,
            materials: materialsTotal.rows[0].materials,
          },
          byAuthor,
        },
      };
    },
  );

  // GET /api/projects/stats — сводная статистика по всем объектам сразу:
  // глобальные итоги + разбивка по авторам с суммами по всем объектам и
  // вложенной детализацией byProject (те же периоды, что и в /:id/stats).
  fastify.get(
    '/stats',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async () => {
      const [worksTotal, materialsTotal, rowsByAuthorProject] = await Promise.all([
        fastify.pool.query(
          `SELECT COUNT(DISTINCT ei.cost_category_id)::int AS categories,
                  COUNT(DISTINCT ei.cost_type_id)::int     AS types,
                  COUNT(*)::int                            AS works
             FROM estimate_items ei`,
        ),
        fastify.pool.query(
          `SELECT COUNT(*)::int AS materials
             FROM estimate_materials em
             JOIN estimates e ON e.id = em.estimate_id`,
        ),
        // Разбивка по авторам и объектам: тот же CTE, что и в /:id/stats, но без
        // фильтра по проекту и с group by по паре (автор, объект) — суммы по
        // автору сворачиваются уже в JS.
        fastify.pool.query(
          `WITH b AS (
             SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')                     AS today_start,
                    date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') - interval '1 day'   AS yest_start,
                    date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') - interval '6 days'  AS week_start,
                    date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') - interval '29 days' AS month_start
           ),
           events AS (
             SELECT ei.created_by AS user_id, ei.project_id, (ei.created_at AT TIME ZONE 'Europe/Moscow') AS cl, false AS is_material
               FROM estimate_items ei
             UNION ALL
             SELECT em.created_by AS user_id, e.project_id, (em.created_at AT TIME ZONE 'Europe/Moscow') AS cl, true AS is_material
               FROM estimate_materials em
               JOIN estimates e ON e.id = em.estimate_id
           )
           SELECT ev.user_id, u.full_name, ev.project_id, p.code AS project_code, p.name AS project_name,
             COUNT(*) FILTER (WHERE NOT ev.is_material AND ev.cl >= b.today_start)::int                          AS works_today,
             COUNT(*) FILTER (WHERE     ev.is_material AND ev.cl >= b.today_start)::int                          AS materials_today,
             COUNT(*) FILTER (WHERE NOT ev.is_material AND ev.cl >= b.yest_start AND ev.cl < b.today_start)::int AS works_yesterday,
             COUNT(*) FILTER (WHERE     ev.is_material AND ev.cl >= b.yest_start AND ev.cl < b.today_start)::int AS materials_yesterday,
             COUNT(*) FILTER (WHERE NOT ev.is_material AND ev.cl >= b.week_start)::int                           AS works_week,
             COUNT(*) FILTER (WHERE     ev.is_material AND ev.cl >= b.week_start)::int                           AS materials_week,
             COUNT(*) FILTER (WHERE NOT ev.is_material AND ev.cl >= b.month_start)::int                          AS works_month,
             COUNT(*) FILTER (WHERE     ev.is_material AND ev.cl >= b.month_start)::int                          AS materials_month,
             COUNT(*) FILTER (WHERE NOT ev.is_material)::int                                                     AS works_total,
             COUNT(*) FILTER (WHERE     ev.is_material)::int                                                     AS materials_total
             FROM events ev
             CROSS JOIN b
             LEFT JOIN users u ON u.id = ev.user_id
             JOIN projects p ON p.id = ev.project_id
            GROUP BY ev.user_id, u.full_name, ev.project_id, p.code, p.name`,
        ),
      ]);

      type Bucket = { works: number; materials: number };
      type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'total';
      const PERIODS: PeriodKey[] = ['today', 'yesterday', 'week', 'month', 'total'];
      const emptyBuckets = (): Record<PeriodKey, Bucket> => ({
        today: { works: 0, materials: 0 },
        yesterday: { works: 0, materials: 0 },
        week: { works: 0, materials: 0 },
        month: { works: 0, materials: 0 },
        total: { works: 0, materials: 0 },
      });

      // Свёртка (автор, объект) → автор: суммируем бакеты по всем объектам.
      // Legacy-строки без автора (created_by = NULL) — одна группа «Не указан».
      const byUser = new Map<
        string,
        {
          userId: string | null;
          name: string;
          byProject: Array<Record<PeriodKey, Bucket> & { projectId: string; code: string; name: string }>;
        } & Record<PeriodKey, Bucket>
      >();
      for (const r of rowsByAuthorProject.rows) {
        const key = r.user_id ?? 'none';
        let author = byUser.get(key);
        if (!author) {
          author = { userId: r.user_id, name: r.full_name ?? 'Не указан', byProject: [], ...emptyBuckets() };
          byUser.set(key, author);
        }
        const project = {
          projectId: r.project_id,
          code: r.project_code,
          name: r.project_name,
          today: { works: r.works_today, materials: r.materials_today },
          yesterday: { works: r.works_yesterday, materials: r.materials_yesterday },
          week: { works: r.works_week, materials: r.materials_week },
          month: { works: r.works_month, materials: r.materials_month },
          total: { works: r.works_total, materials: r.materials_total },
        };
        author.byProject.push(project);
        for (const p of PERIODS) {
          author[p].works += project[p].works;
          author[p].materials += project[p].materials;
        }
      }

      const byAuthor = [...byUser.values()].sort(
        (a, b) => b.total.works - a.total.works || b.total.materials - a.total.materials,
      );
      for (const a of byAuthor) {
        a.byProject.sort((x, y) => y.total.works - x.total.works || y.total.materials - x.total.materials);
      }

      const t = worksTotal.rows[0];
      return {
        data: {
          totals: {
            categories: t.categories,
            types: t.types,
            works: t.works,
            materials: materialsTotal.rows[0].materials,
          },
          byAuthor,
        },
      };
    },
  );

  // GET /api/projects/:id/estimate — единая смета на объект.
  // get-or-create: если смет нет — создаём одну; если несколько — сливаем
  // позиции/материалы/подрядчиков в самую раннюю (primary), пустые удаляем.
  fastify.get<{ Params: { id: string } }>(
    '/:id/estimate',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const projectId = request.params.id;
      const { rows: projectRows } = await fastify.pool.query(
        'SELECT id FROM projects WHERE id = $1',
        [projectId],
      );
      if (projectRows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });

      const client = await fastify.pool.connect();
      let primaryId: string;
      try {
        await client.query('BEGIN');
        const { rows: ests } = await client.query(
          'SELECT id FROM estimates WHERE project_id = $1 ORDER BY created_at ASC',
          [projectId],
        );
        if (ests.length === 0) {
          const ins = await client.query(
            'INSERT INTO estimates (project_id, created_by) VALUES ($1, $2) RETURNING id',
            [projectId, request.currentUser.id],
          );
          primaryId = ins.rows[0].id as string;
        } else {
          primaryId = ests[0].id as string;
          if (ests.length > 1) {
            const others = ests.slice(1).map((e) => e.id as string);
            await client.query('UPDATE estimate_items SET estimate_id = $1 WHERE estimate_id = ANY($2)', [primaryId, others]);
            await client.query('UPDATE estimate_materials SET estimate_id = $1 WHERE estimate_id = ANY($2)', [primaryId, others]);
            await client.query(
              `INSERT INTO estimate_contractors (estimate_id, cost_type_id, contractor_id)
               SELECT $1, cost_type_id, contractor_id FROM estimate_contractors WHERE estimate_id = ANY($2)
               ON CONFLICT (estimate_id, cost_type_id) DO NOTHING`,
              [primaryId, others],
            );
            await client.query('DELETE FROM estimates WHERE id = ANY($1)', [others]);
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      const data = await buildEstimateDetail(fastify.pool, primaryId);
      return { data };
    },
  );
}
