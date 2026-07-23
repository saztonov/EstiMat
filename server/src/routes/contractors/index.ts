// Чтение раздела «Подрядчики»: галерея объектов и строки кабинета подрядчика.
//
// Назначения здесь только читаются. Назначить и снять подрядчика можно единственным путём —
// через реестр «ВОР объекта» (routes/estimates/vor-assign.ts): работа достаётся исполнителю
// целиком, поэтому долей и построчных мутаций больше нет.
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { withImageSrc } from '../../lib/projectImage.js';
import { bucketBy, fetchCostTypeCiphers, ITEMS_CANONICAL_ORDER_BY } from '../../lib/estimate-detail.js';
import { isContractor } from '../../lib/chat/access.js';

// Договорные поля — только для сотрудников: в кабинете подрядчика их быть не должно ни в
// интерфейсе, ни в ответе API (выборки идут через ei.*/em.*, поэтому чистим явно).
const CONTRACT_PRICE_FIELDS = [
  'contract_unit_price',
  'contract_total',
  'contract_price_vor_id',
  'contract_price_contractor_id',
  'contract_price_updated_at',
  'contract_price_updated_by',
] as const;

function stripContractPrice<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const f of CONTRACT_PRICE_FIELDS) delete out[f];
  return out;
}

export default async function contractorRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // ============================================================
  // GET /api/contractors/estimates — объекты/сметы для раздела + счётчики.
  // Денежных итогов здесь нет: раздел про раздачу работ подрядчикам, а не про суммы.
  // ============================================================
  fastify.get('/estimates', async (request) => {
    const user = request.currentUser;

    // Подрядчик: объекты, назначенные его организации (project_contractors); счётчик строк —
    // по его строкам. Объект без заведённой сметы тоже виден (estimate_id=null → некликабелен).
    // Договоры — только свои: фильтр по $1 стоит внутри предагрегата, поэтому чужие номера и
    // даты не покидают сервер даже как промежуточный результат.
    if (isContractor(user)) {
      if (!user.orgId) return { data: [] };
      const { rows } = await fastify.pool.query(
        `SELECT e.id AS estimate_id, e.project_id, e.work_type,
                p.code AS project_code, p.name AS project_name,
                p.address, p.image_url,
                cc.name AS cost_category_name,
                COUNT(DISTINCT eic.item_id)::int AS items_total,
                COALESCE(cs.contracts, '[]'::jsonb) AS contracts
           FROM project_contractors pc
           JOIN projects p        ON p.id = pc.project_id
           LEFT JOIN estimates e  ON e.project_id = p.id
           LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
           LEFT JOIN estimate_item_contractors eic
                  ON eic.estimate_id = e.id AND eic.contractor_id = pc.contractor_id
           LEFT JOIN (
             SELECT v.estimate_id,
                    jsonb_agg(
                      jsonb_build_object('number', vc.contract_number, 'date', vc.contract_date::text)
                      ORDER BY vc.contract_date DESC NULLS LAST, vc.assigned_at DESC, vc.id
                    ) AS contracts
               FROM estimate_vor_contractors vc
               JOIN estimate_vors v ON v.id = vc.vor_id
              WHERE vc.contractor_id = $1
              GROUP BY v.estimate_id
           ) cs ON cs.estimate_id = e.id
          WHERE pc.contractor_id = $1
          GROUP BY e.id, p.id, cc.name, cs.contracts
          ORDER BY p.code`,
        [user.orgId],
      );
      return { data: rows.map((r) => withImageSrc(fastify, r)) };
    }

    // Инженер/админ/менеджер: все объекты (карточка = объект, у объекта одна смета).
    // Корень — projects, смета через LEFT JOIN: объекты без заведённой сметы тоже
    // попадают в галерею (estimate_id = NULL, счётчики 0). Счётчик строк — по смете объекта,
    // ВОР — по реестру выгрузок: назначенным считается ВОР с договорной связкой, даже если
    // живых строк за подрядчиком не осталось (то же, что показывает окно «ВОР объекта»).
    const { rows } = await fastify.pool.query(
      `SELECT e.id AS estimate_id, e.project_id, e.work_type,
              p.code AS project_code, p.name AS project_name,
              p.address, p.image_url,
              cc.name AS cost_category_name,
              COUNT(ei.id)::int AS items_total,
              COALESCE(vs.vors_total, 0)    AS vors_total,
              COALESCE(vs.vors_assigned, 0) AS vors_assigned
         FROM projects p
         LEFT JOIN estimates e        ON e.project_id = p.id
         LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
         LEFT JOIN estimate_items ei  ON ei.estimate_id = e.id
         LEFT JOIN (
           SELECT v.estimate_id,
                  COUNT(*)::int AS vors_total,
                  COUNT(*) FILTER (
                    WHERE EXISTS (SELECT 1 FROM estimate_vor_contractors vc WHERE vc.vor_id = v.id)
                  )::int AS vors_assigned
             FROM estimate_vors v
            GROUP BY v.estimate_id
         ) vs ON vs.estimate_id = e.id
        GROUP BY p.id, e.id, cc.name, vs.vors_total, vs.vors_assigned
        ORDER BY p.code`,
    );
    return { data: rows.map((r) => withImageSrc(fastify, r)) };
  });

  // ============================================================
  // GET /api/contractors/my-items — строки, назначенные организации подрядчика
  //   (admin/engineer могут смотреть «глазами подрядчика» через ?contractorId=)
  // ============================================================
  fastify.get<{ Querystring: { projectId?: string; estimateId?: string; contractorId?: string } }>(
    '/my-items',
    { preHandler: [requireRole('contractor', 'admin', 'engineer')] },
    async (request, reply) => {
      const user = request.currentUser;
      const contractorId = isContractor(user) ? user.orgId : (request.query.contractorId ?? null);
      if (!contractorId) {
        return reply.status(400).send({ error: 'Не указана организация-подрядчик' });
      }

      // Подрядчик может открывать только сметы объектов, назначенных его организации.
      if (isContractor(user) && request.query.estimateId) {
        const access = await fastify.pool.query(
          `SELECT 1 FROM estimates e
             JOIN project_contractors pc ON pc.project_id = e.project_id
            WHERE e.id = $1 AND pc.contractor_id = $2`,
          [request.query.estimateId, contractorId],
        );
        if (access.rows.length === 0) {
          return reply.status(403).send({ error: 'Объект не назначен вашей организации' });
        }
      }

      const values: unknown[] = [contractorId];
      let where = 'eic.contractor_id = $1';
      if (request.query.projectId) {
        values.push(request.query.projectId);
        where += ` AND ei.project_id = $${values.length}`;
      }
      if (request.query.estimateId) {
        values.push(request.query.estimateId);
        where += ` AND ei.estimate_id = $${values.length}`;
      }

      const items = await fastify.pool.query(
        `SELECT ei.*,
                r.name  AS rate_name,
                r.code  AS rate_code,
                ct.name AS cost_type_name,
                cc.name AS cost_category_name,
                z.name  AS zone_name,
                z.kind  AS zone_kind,
                rt.name AS room_type_name,
                lt.name AS location_type_name,
                eic.contractor_id AS my_contractor_id
           FROM estimate_item_contractors eic
           JOIN estimate_items ei       ON ei.id = eic.item_id
           LEFT JOIN rates r            ON ei.rate_id = r.id
           LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
           LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
           LEFT JOIN project_zones z    ON ei.zone_id = z.id
           LEFT JOIN room_types rt      ON ei.room_type_id = rt.id
           LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
          WHERE ${where}
          ORDER BY ${ITEMS_CANONICAL_ORDER_BY}`,
        values,
      );

      const itemIds = items.rows.map((it) => it.id);
      const materials = itemIds.length
        ? (
            await fastify.pool.query(
              `SELECT em.*, mc.name AS material_name
                 FROM estimate_materials em
                 LEFT JOIN material_catalog mc ON em.material_id = mc.id
                WHERE em.item_id = ANY($1)
                ORDER BY em.sort_order, em.created_at`,
              [itemIds],
            )
          ).rows
        : [];

      // Бакетизация за один проход вместо .filter() внутри .map() (порядок задан ORDER BY).
      // Договорные цены снимаем с ответа: они предназначены сотрудникам (раздел «Подрядчики»),
      // а выборка идёт через ei.*/em.* — иначе новая колонка автоматически уехала бы подрядчику.
      const materialsByItem = bucketBy(materials.map(stripContractPrice), (m) => m.item_id as string);
      const itemsWithMaterials = items.rows.map((it) => ({
        ...stripContractPrice(it),
        materials: materialsByItem.get(it.id as string) ?? [],
      }));

      // Шифры РД по видам работ: подрядчику справочник шифров объекта закрыт, и детализацию сметы
      // он не запрашивает — этот роут единственный путь доставки. Только при выборке по одной
      // смете: индекс по cost_type_id между сметами неоднозначен.
      const costTypeCiphers = request.query.estimateId
        ? await fetchCostTypeCiphers(fastify.pool, request.query.estimateId)
        : {};

      return { data: { items: itemsWithMaterials, cost_type_ciphers: costTypeCiphers } };
    },
  );
}
