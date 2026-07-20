import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  formLotSchema, startProcurementSchema, awardSchema, mapTenderUnit,
  upsertOfferSchema, offerFileMetaSchema, finalizeOrderSchema,
  putOrderDeliveryScheduleSchema,
  assignMaterialResponsibleSchema, bulkAssignMaterialResponsibleSchema,
  setMaterialResponsiblesSchema, bulkSetMaterialResponsiblesSchema,
  MANUAL_VAT_RATE_VALUE, type ManualVatRate,
} from '@estimat/shared';
import { config } from '../../config.js';
import { recalcRequestStatus } from '../../lib/requests/status-recalc.js';
import { recordAudit } from '../../lib/audit.js';
import { appendOrderAudit } from '../../lib/supplier-orders/helpers.js';
import { assertCategoryAccess } from '../../lib/procurement/access.js';
import { exportSupplierOrderXlsx, SupplierOrderExportError } from '../../lib/supplier-order-export/index.js';
import { refreshTenderLot } from '../../lib/tender/sync.js';
import { TenderApiError, TenderNotConfiguredError } from '../../lib/tender/errors.js';
import { guardedStreamUpload, FileGuardError } from '../../lib/uploads/file-guard.js';

const FILE_LIMIT = 50 * 1024 * 1024; // 50 МБ на файл предложения
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Все переданные пользователи активны и во внутренней роли (могут быть ответственными).
// userIds уже дедуплицированы схемой → сравнение count === length корректно. Пустой набор — ок.
type PoolClientLike = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
async function assertAssignable(client: PoolClientLike, userIds: string[]): Promise<boolean> {
  if (userIds.length === 0) return true;
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM users
      WHERE id = ANY($1::uuid[]) AND is_active = true AND role IN ('admin','engineer','manager')`,
    [userIds],
  );
  return (rows[0]?.n ?? 0) === userIds.length;
}

/**
 * Закупочные лоты СУ-10 (supplier_orders.kind='sourcing'). Инструмент снабжения — доступ только
 * внутренним ролям (admin/engineer/manager). Лот сводит материалы из нескольких su10-заявок
 * (связь заявка↔лот многие-ко-многим по количеству через supplier_order_items).
 *
 * Инвариант И1 (нет закупки сверх заявленного): любое изменение состава — в транзакции с блокировкой
 * исходных строк material_request_items (FOR UPDATE), пересчётом размещённого по активным лотам
 * (numeric в SQL) и optimistic-lock лота (row_version). Количество позиции в лоте — абсолютное.
 */
export default async function supplierOrderRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('admin', 'engineer', 'manager'));

  // ============================================================
  // GET /materials — свод материалов заявок (все виды) с фильтрами и серверной пагинацией.
  //   Строки = исходные позиции заявок. Для su10 «ordered/remaining» = размещённое/остаток по
  //   активным лотам (заказ поставщику формируется только из su10). Для прочих видов размещение
  //   не применяется → ordered/remaining = null. Опции фильтров (facets) считаются по всему
  //   доступному набору, без учёта текущих фильтров (иначе фильтры «схлопнули» бы сами себя).
  // ============================================================
  fastify.get<{
    Querystring: {
      projectId?: string;
      contractorId?: string;
      requestType?: string;
      categoryId?: string;
      limit?: string;
      offset?: string;
      all?: string;
    };
  }>('/materials', async (request) => {
    const q = request.query;
    // Режим группировки на клиенте (all=1) требует весь набор, а не одну страницу. Полностью
    // снимать лимит опасно → жёсткий потолок; клиент по meta.truncated честно предупредит.
    const MATERIALS_GROUP_CAP = 5000;
    const groupAll = q.all === '1';
    const limit = groupAll ? MATERIALS_GROUP_CAP : Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const offset = groupAll ? 0 : Math.max(Number(q.offset) || 0, 0);

    // Динамические фильтры (базовый инвариант — не отменённые заявки).
    const where: string[] = [`mr.status <> 'cancelled'`];
    const values: unknown[] = [];
    if (q.projectId) { values.push(q.projectId); where.push(`mr.project_id = $${values.length}`); }
    if (q.contractorId) { values.push(q.contractorId); where.push(`mr.contractor_id = $${values.length}`); }
    if (q.requestType) { values.push(q.requestType); where.push(`mr.request_type = $${values.length}`); }
    if (q.categoryId) { values.push(q.categoryId); where.push(`cc.id = $${values.length}`); }
    const whereSql = where.join(' AND ');

    const dataValues = [...values, limit, offset];
    const { rows } = await fastify.pool.query(
      `SELECT mri.id AS request_item_id, mri.request_id, mr.request_no, mr.request_type, mr.status,
              mr.project_id, mr.project_name, p.code AS project_code,
              mri.cost_type_id, ct.name AS cost_type_name,
              cc.id AS category_id, cc.name AS category_name,
              cc.sort_order AS category_sort, ct.sort_order AS cost_type_sort,
              mri.material_id, mri.material_name, mri.unit, mri.agg_key,
              to_char(mri.delivery_date, 'YYYY-MM-DD') AS delivery_date,
              mri.quantity::numeric AS requested, COALESCE(placed.qty, 0)::numeric AS placed,
              mr.contractor_id, mr.contractor_name,
              COALESCE((
                SELECT json_agg(json_build_object('id', u.id, 'full_name', u.full_name) ORDER BY u.full_name, u.id)
                  FROM material_request_item_responsibles r
                  JOIN users u ON u.id = r.user_id
                 WHERE r.request_item_id = mri.id
              ), '[]') AS assigned_responsibles,
              COUNT(*) OVER() AS total_count
         FROM material_request_items mri
         JOIN material_requests mr ON mr.id = mri.request_id
         LEFT JOIN projects p ON p.id = mr.project_id
         LEFT JOIN cost_types ct ON ct.id = mri.cost_type_id
         LEFT JOIN cost_categories cc ON cc.id = ct.category_id
         LEFT JOIN (
           SELECT soi.request_item_id, SUM(soi.quantity) AS qty
             FROM supplier_order_items soi
             JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status NOT IN ('cancelled','no_award')
            GROUP BY soi.request_item_id
         ) placed ON placed.request_item_id = mri.id
        WHERE ${whereSql}
        ORDER BY mr.project_name NULLS LAST, cc.sort_order NULLS LAST, ct.sort_order NULLS LAST,
                 mri.material_name, mri.delivery_date NULLS LAST
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      dataValues,
    );

    // Facets — по всему доступному набору (только базовый инвариант, без текущих фильтров).
    const { rows: facetRows } = await fastify.pool.query(
      `SELECT
         COALESCE((SELECT json_agg(row_to_json(t)) FROM (
           SELECT DISTINCT mr.project_id AS id, mr.project_name AS name, p.code
             FROM material_request_items mri JOIN material_requests mr ON mr.id = mri.request_id
             LEFT JOIN projects p ON p.id = mr.project_id
            WHERE mr.status <> 'cancelled' AND mr.project_id IS NOT NULL
            ORDER BY mr.project_name
         ) t), '[]') AS projects,
         COALESCE((SELECT json_agg(row_to_json(t)) FROM (
           SELECT DISTINCT mr.contractor_id AS id, mr.contractor_name AS name
             FROM material_request_items mri JOIN material_requests mr ON mr.id = mri.request_id
            WHERE mr.status <> 'cancelled' AND mr.contractor_id IS NOT NULL
            ORDER BY mr.contractor_name
         ) t), '[]') AS contractors,
         COALESCE((SELECT json_agg(row_to_json(t)) FROM (
           SELECT DISTINCT cc.id, cc.name
             FROM material_request_items mri JOIN material_requests mr ON mr.id = mri.request_id
             JOIN cost_types ct ON ct.id = mri.cost_type_id
             JOIN cost_categories cc ON cc.id = ct.category_id
            WHERE mr.status <> 'cancelled'
            ORDER BY cc.name
         ) t), '[]') AS categories`,
    );

    const total = rows.length ? Number(rows[0].total_count) : 0;
    return {
      data: rows.map(({ total_count, placed, ...r }) => {
        const isSu10 = r.request_type === 'su10';
        const ordered = isSu10 ? Number(placed) : null;
        const remaining = isSu10 ? Number(r.requested) - Number(placed) : null;
        // Deprecated-поля для незакрытых старых вкладок — первый из отсортированного набора.
        const first = (r.assigned_responsibles as { id: string; full_name: string }[])[0] ?? null;
        return {
          ...r, ordered, remaining,
          assigned_responsible_id: first?.id ?? null,
          assigned_responsible_name: first?.full_name ?? null,
        };
      }),
      meta: { total, limit, offset, truncated: total > rows.length, facets: facetRows[0] },
    };
  });

  // ============================================================
  // Ответственные за строку материала (many-to-many, override поверх ответственных по категории).
  //   Пустой набор — override сброшен: строка снова показывает всех ответственных по категории.
  //   Назначение информационное: прав формирования закупок (assertCategoryAccess) не меняет.
  // ============================================================

  // Полная замена набора ответственных одной строки. Уже назначенных (в т.ч. ставших неактивными)
  // разрешаем сохранить/снять — валидируем во внутренней роли только ДОБАВЛЯЕМЫХ.
  async function applySetRowResponsibles(
    requestItemId: string, userIds: string[], actorId: string,
  ): Promise<{ status: number; body: unknown }> {
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: itemRows } = await client.query(
        `SELECT mr.status, mr.estimate_id, mr.project_id
           FROM material_request_items mri JOIN material_requests mr ON mr.id = mri.request_id
          WHERE mri.id = $1 FOR UPDATE OF mri`,
        [requestItemId],
      );
      if (!itemRows[0]) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'Позиция не найдена' } }; }
      if (itemRows[0].status === 'cancelled') { await client.query('ROLLBACK'); return { status: 409, body: { error: 'Заявка отменена' } }; }

      const { rows: cur } = await client.query(
        `SELECT user_id FROM material_request_item_responsibles WHERE request_item_id = $1`, [requestItemId],
      );
      const currentSet = new Set(cur.map((r) => r.user_id as string));
      const added = userIds.filter((id) => !currentSet.has(id));
      if (!(await assertAssignable(client, added))) {
        await client.query('ROLLBACK');
        return { status: 400, body: { error: 'Пользователь не может быть ответственным' } };
      }

      // Diff: снять отсутствующих в новом наборе (пустой набор → снять всех: x <> ALL('{}') = true),
      // добавить новых. Метаданные существующих не трогаем — сохраняем историю назначения.
      await client.query(
        `DELETE FROM material_request_item_responsibles WHERE request_item_id = $1 AND user_id <> ALL($2::uuid[])`,
        [requestItemId, userIds],
      );
      if (userIds.length) {
        await client.query(
          `INSERT INTO material_request_item_responsibles (request_item_id, user_id, assigned_by)
           SELECT $1, u, $3 FROM unnest($2::uuid[]) u
           ON CONFLICT (request_item_id, user_id) DO NOTHING`,
          [requestItemId, userIds, actorId],
        );
      }
      await recordAudit(client, {
        estimateId: itemRows[0].estimate_id, projectId: itemRows[0].project_id,
        entityType: 'material_request_item', entityId: requestItemId,
        action: 'material.responsible.set', userId: actorId, changes: { userIds },
      });
      const { rows: result } = await client.query(
        `SELECT u.id, u.full_name FROM material_request_item_responsibles r JOIN users u ON u.id = r.user_id
          WHERE r.request_item_id = $1 ORDER BY u.full_name, u.id`,
        [requestItemId],
      );
      await client.query('COMMIT');
      return { status: 200, body: { data: { requestItemId, responsibles: result } } };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }

  // Массовое назначение на набор строк узла дерева. 'add' — добавить выбранных ко всем (текущих
  // не трогает); 'replace' — заменить набор (userIds=[] = массовый сброс). «Всё или ничего»:
  // существование/статус позиций проверяем ОТДЕЛЬНЫМ SELECT (не по числу вставок).
  async function applyBulkResponsibles(
    requestItemIds: string[], userIds: string[], mode: 'add' | 'replace', actorId: string,
  ): Promise<{ status: number; body: unknown }> {
    // Потолок произведения строк×пользователей — защита от разрастания одной операции.
    if (requestItemIds.length * Math.max(userIds.length, 1) > 20000) {
      return { status: 400, body: { error: 'Слишком большой набор — сузьте выбор' } };
    }
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: found } = await client.query(
        `SELECT mr.status FROM material_request_items mri JOIN material_requests mr ON mr.id = mri.request_id
          WHERE mri.id = ANY($1::uuid[]) FOR UPDATE OF mri`,
        [requestItemIds],
      );
      if (found.length !== requestItemIds.length) {
        await client.query('ROLLBACK'); return { status: 404, body: { error: 'Часть позиций не найдена' } };
      }
      if (found.some((r) => r.status === 'cancelled')) {
        await client.query('ROLLBACK'); return { status: 409, body: { error: 'Среди позиций есть отменённые заявки' } };
      }
      if (!(await assertAssignable(client, userIds))) {
        await client.query('ROLLBACK'); return { status: 400, body: { error: 'Пользователь не может быть ответственным' } };
      }
      if (mode === 'replace') {
        await client.query(
          `DELETE FROM material_request_item_responsibles
            WHERE request_item_id = ANY($1::uuid[]) AND user_id <> ALL($2::uuid[])`,
          [requestItemIds, userIds],
        );
      }
      if (userIds.length) {
        await client.query(
          `INSERT INTO material_request_item_responsibles (request_item_id, user_id, assigned_by)
           SELECT i, u, $3 FROM unnest($1::uuid[]) i CROSS JOIN unnest($2::uuid[]) u
           ON CONFLICT (request_item_id, user_id) DO NOTHING`,
          [requestItemIds, userIds, actorId],
        );
      }
      await recordAudit(client, {
        estimateId: null, entityType: 'material_request_item', entityId: requestItemIds[0]!,
        action: 'material.responsible.bulk_set', userId: actorId,
        changes: { userIds, mode, count: requestItemIds.length, requestItemIds },
      });
      await client.query('COMMIT');
      return { status: 200, body: { data: { updated: requestItemIds.length } } };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }

  // PUT /materials/:requestItemId/responsibles — заменить набор ответственных строки.
  fastify.put<{ Params: { requestItemId: string } }>('/materials/:requestItemId/responsibles', async (request, reply) => {
    const { userIds } = setMaterialResponsiblesSchema.parse(request.body);
    const { requestItemId } = request.params;
    if (!UUID_RE.test(requestItemId)) return reply.status(400).send({ error: 'Некорректный идентификатор позиции' });
    const r = await applySetRowResponsibles(requestItemId, userIds, request.currentUser.id);
    return reply.status(r.status).send(r.body);
  });

  // PATCH /materials/responsibles — массовое (add/replace) на набор строк узла дерева.
  fastify.patch('/materials/responsibles', async (request, reply) => {
    const { requestItemIds, userIds, mode } = bulkSetMaterialResponsiblesSchema.parse(request.body);
    const r = await applyBulkResponsibles(requestItemIds, userIds, mode, request.currentUser.id);
    return reply.status(r.status).send(r.body);
  });

  // Legacy (на один релиз, для незакрытых старых вкладок): прежние одиночный/массовый маршруты
  // «один ответственный». userId → набор [userId] (или [] при null = сброс), семантика replace.
  fastify.patch<{ Params: { requestItemId: string } }>('/materials/:requestItemId/responsible', async (request, reply) => {
    const { userId } = assignMaterialResponsibleSchema.parse(request.body);
    const { requestItemId } = request.params;
    if (!UUID_RE.test(requestItemId)) return reply.status(400).send({ error: 'Некорректный идентификатор позиции' });
    const r = await applySetRowResponsibles(requestItemId, userId ? [userId] : [], request.currentUser.id);
    return reply.status(r.status).send(r.body);
  });
  fastify.patch('/materials/responsible', async (request, reply) => {
    const { requestItemIds, userId } = bulkAssignMaterialResponsibleSchema.parse(request.body);
    const r = await applyBulkResponsibles([...new Set(requestItemIds)], userId ? [userId] : [], 'replace', request.currentUser.id);
    return reply.status(r.status).send(r.body);
  });

  // ============================================================
  // POST / — сформировать новый лот или добавить позиции в существующий (forming)
  // ============================================================
  fastify.post('/', async (request, reply) => {
    const user = request.currentUser;
    const body = formLotSchema.parse(request.body);
    const itemIds = body.items.map((i) => i.requestItemId);
    const wantQty = body.items.map((i) => String(i.quantity));

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');

      // --- Резолв лота: append (по orderId) или create (идемпотентно по clientRequestId) ---
      let orderId: string;
      if (body.orderId) {
        const { rows } = await client.query(
          `SELECT id, project_id, sourcing_status, row_version FROM supplier_orders
            WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
          [body.orderId],
        );
        const lot = rows[0];
        if (!lot) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Заказ не найден' });
        }
        if (lot.sourcing_status !== 'forming') {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Заказ зафиксирован — состав менять нельзя' });
        }
        if (lot.project_id !== body.projectId) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Заказ относится к другому объекту' });
        }
        if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: lot.row_version });
        }
        orderId = lot.id;
      } else {
        const dup = await client.query(
          `SELECT id, project_id, sourcing_status FROM supplier_orders
            WHERE created_by = $1 AND client_request_id = $2 FOR UPDATE`,
          [user.id, body.clientRequestId],
        );
        if (dup.rows[0]) {
          // Повтор запроса — тот же лот (позиции UPSERT'ятся идемпотентно), но только пока он
          // формируется и относится к тому же объекту (иначе повтором нельзя дописать в лот,
          // ушедший в закупку/отменённый).
          const d = dup.rows[0];
          if (d.sourcing_status !== 'forming' || d.project_id !== body.projectId) {
            await client.query('ROLLBACK');
            return reply.status(409).send({ error: 'Повторный запрос по изменённому заказу, обновите страницу' });
          }
          orderId = d.id;
        } else {
          await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [body.projectId]);
          const { rows: pRows } = await client.query('SELECT name FROM projects WHERE id = $1', [body.projectId]);
          if (!pRows[0]) {
            await client.query('ROLLBACK');
            return reply.status(404).send({ error: 'Объект не найден' });
          }
          const { rows: noRows } = await client.query(
            `SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM supplier_orders WHERE project_id = $1 AND kind = 'sourcing'`,
            [body.projectId],
          );
          const { rows: insRows } = await client.query(
            `INSERT INTO supplier_orders
               (kind, project_id, project_name, order_no, title, sourcing_status, client_request_id, created_by)
             VALUES ('sourcing', $1, $2, $3, $4, 'forming', $5, $6)
             RETURNING id`,
            [body.projectId, pRows[0].name ?? null, Number(noRows[0].n), body.title ?? null, body.clientRequestId, user.id],
          );
          orderId = insRows[0].id;
        }
      }

      // --- Блокировка исходных строк (И1, стабильный порядок по id) + снимки для позиций лота ---
      const { rows: src } = await client.query(
        `SELECT mri.id, mri.request_id, mri.cost_type_id, mri.agg_key, mri.material_id, mri.material_name,
                mri.unit, mri.delivery_date, mr.contractor_id, mr.contractor_name, mr.request_no, mr.project_id,
                mr.request_type, mr.status, ct.category_id, ct.name AS cost_type_name, cc.name AS cost_category_name
           FROM material_request_items mri
           JOIN material_requests mr ON mr.id = mri.request_id
           LEFT JOIN cost_types ct ON ct.id = mri.cost_type_id
           LEFT JOIN cost_categories cc ON cc.id = ct.category_id
          WHERE mri.id = ANY($1::uuid[])
          ORDER BY mri.id
          FOR UPDATE OF mri`,
        [itemIds],
      );
      const srcMap = new Map(src.map((r) => [r.id, r]));
      for (const it of body.items) {
        const r = srcMap.get(it.requestItemId);
        if (!r) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Строка заявки не найдена' });
        }
        if (r.request_type !== 'su10') {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'В заказ попадают только материалы заявок СУ-10' });
        }
        if (r.project_id !== body.projectId) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Материал относится к другому объекту' });
        }
        if (r.status === 'cancelled' || r.status === 'revision') {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Заявка отменена или на доработке — материалы недоступны' });
        }
      }

      // Разграничение по зонам ответственности (справочник «Закупки»): формировать заказ по
      // категории может только её ответственный или админ (fallback — категория без ответственных).
      const access = await assertCategoryAccess(
        client,
        user.id,
        user.role,
        body.items.map((it) => srcMap.get(it.requestItemId)!.category_id ?? null),
      );
      if (!access.ok) {
        await client.query('ROLLBACK');
        return reply.status(403).send({ error: access.reason });
      }

      // --- Проверка остатка в SQL (numeric): want > requested − размещённое в ДРУГИХ активных лотах ---
      const { rows: viol } = await client.query(
        `WITH req(request_item_id, want) AS (
           SELECT * FROM unnest($1::uuid[], $2::numeric[])
         )
         SELECT req.request_item_id::text AS request_item_id, mri.material_name,
                mri.quantity AS requested, COALESCE(pl.qty, 0) AS placed, req.want
           FROM req
           JOIN material_request_items mri ON mri.id = req.request_item_id
           LEFT JOIN (
             SELECT soi.request_item_id, SUM(soi.quantity) AS qty
               FROM supplier_order_items soi
               JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status NOT IN ('cancelled','no_award')
              WHERE soi.order_id <> $3
              GROUP BY soi.request_item_id
           ) pl ON pl.request_item_id = req.request_item_id
          WHERE req.want > mri.quantity - COALESCE(pl.qty, 0)`,
        [itemIds, wantQty, orderId],
      );
      if (viol.length) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          error: 'Превышен доступный остаток по материалам',
          items: viol.map((v) => ({
            requestItemId: v.request_item_id,
            name: v.material_name,
            remaining: Number(v.requested) - Number(v.placed),
            requested: Number(v.want),
          })),
        });
      }

      // --- UPSERT позиций (количество абсолютное) ---
      for (const it of body.items) {
        const r = srcMap.get(it.requestItemId)!;
        await client.query(
          `INSERT INTO supplier_order_items
             (order_id, request_id, request_item_id, cost_type_id, material_id, material_name, unit, agg_key,
              quantity, contractor_id, contractor_name, request_no, cost_type_name, cost_category_name, delivery_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (order_id, request_item_id) DO UPDATE SET quantity = EXCLUDED.quantity,
             delivery_date = EXCLUDED.delivery_date`,
          [
            orderId, r.request_id, r.id, r.cost_type_id, r.material_id, r.material_name, r.unit, r.agg_key,
            it.quantity, r.contractor_id, r.contractor_name, r.request_no, r.cost_type_name, r.cost_category_name,
            r.delivery_date,
          ],
        );
      }

      // --- График поставки заказа (по agg_key) ---
      // Если снабжение прислало свой график — валидируем (сумма == количеству agg_key в заказе,
      // даты уникальны) и REPLACE'им по переданным agg_key. Затем предзаполняем снимком дат заявки
      // только те agg_key, у которых графика ещё нет (не затирая ручные правки/только что заданное).
      if (body.deliverySchedule?.length) {
        const SCHED_EPS = 1e-6;
        const { rows: aggRows } = await client.query(
          `SELECT agg_key, SUM(quantity)::numeric AS qty FROM supplier_order_items WHERE order_id = $1 GROUP BY agg_key`,
          [orderId],
        );
        const aggQty = new Map<string, number>(aggRows.map((a) => [a.agg_key as string, Number(a.qty)]));
        for (const line of body.deliverySchedule) {
          if (!aggQty.has(line.aggKey)) {
            await client.query('ROLLBACK');
            return reply.status(400).send({ error: 'График задан по материалу вне состава заказа' });
          }
          const dates = line.entries.map((e) => e.deliveryDate);
          if (new Set(dates).size !== dates.length) {
            await client.query('ROLLBACK');
            return reply.status(400).send({ error: 'Даты поставки в графике не должны повторяться' });
          }
          const sum = line.entries.reduce((s, e) => s + e.quantity, 0);
          if (Math.abs(sum - (aggQty.get(line.aggKey) ?? 0)) > SCHED_EPS) {
            await client.query('ROLLBACK');
            return reply.status(400).send({ error: 'Сумма графика не совпадает с количеством материала в заказе' });
          }
        }
        await client.query(
          `DELETE FROM supplier_order_delivery_schedule WHERE order_id = $1 AND agg_key = ANY($2::text[])`,
          [orderId, body.deliverySchedule.map((l) => l.aggKey)],
        );
        for (const line of body.deliverySchedule) {
          for (const e of line.entries) {
            await client.query(
              `INSERT INTO supplier_order_delivery_schedule (order_id, agg_key, delivery_date, quantity)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (order_id, agg_key, delivery_date) DO UPDATE SET quantity = EXCLUDED.quantity`,
              [orderId, line.aggKey, e.deliveryDate, e.quantity],
            );
          }
        }
      }
      // Авто-prefill снимком дат заявки — только для agg_key, у которых графика ещё нет.
      await client.query(
        `INSERT INTO supplier_order_delivery_schedule (order_id, agg_key, delivery_date, quantity)
         SELECT soi.order_id, soi.agg_key, soi.delivery_date, SUM(soi.quantity)
           FROM supplier_order_items soi
          WHERE soi.order_id = $1 AND soi.delivery_date IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM supplier_order_delivery_schedule s
               WHERE s.order_id = soi.order_id AND s.agg_key = soi.agg_key
            )
          GROUP BY soi.order_id, soi.agg_key, soi.delivery_date
         ON CONFLICT (order_id, agg_key, delivery_date) DO NOTHING`,
        [orderId],
      );

      await client.query('UPDATE supplier_orders SET row_version = row_version + 1, updated_at = now() WHERE id = $1', [orderId]);
      await appendOrderAudit(client, {
        orderId, action: 'items_added', userId: user.id,
        changes: { count: body.items.length }, projectId: body.projectId,
      });
      for (const rid of new Set(src.map((r) => r.request_id))) {
        await recalcRequestStatus(client, rid as string, user.id);
      }

      const { rows: fin } = await client.query('SELECT order_no, row_version FROM supplier_orders WHERE id = $1', [orderId]);
      await client.query('COMMIT');
      return reply.status(201).send({ data: { id: orderId, orderNo: fin[0].order_no, rowVersion: fin[0].row_version } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // DELETE /:id/items/:itemId — убрать позицию из формируемого лота
  // ============================================================
  fastify.delete<{ Params: { id: string; itemId: string } }>('/:id/items/:itemId', async (request, reply) => {
    const user = request.currentUser;
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, created_by FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (user.role !== 'admin' && lot.created_by !== user.id) {
        await client.query('ROLLBACK');
        return reply.status(403).send({ error: 'Изменять состав заказа может только его создатель или администратор' });
      }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ зафиксирован — состав менять нельзя' });
      }
      const { rows: delRows } = await client.query(
        `DELETE FROM supplier_order_items WHERE id = $1 AND order_id = $2 RETURNING request_id`,
        [request.params.itemId, lot.id],
      );
      if (!delRows[0]) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Позиция не найдена' }); }
      await client.query('UPDATE supplier_orders SET row_version = row_version + 1, updated_at = now() WHERE id = $1', [lot.id]);
      await appendOrderAudit(client, { orderId: lot.id, action: 'item_removed', userId: user.id, projectId: lot.project_id });
      if (delRows[0].request_id) await recalcRequestStatus(client, delRows[0].request_id, user.id);
      await client.query('COMMIT');
      return { data: { ok: true } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // PUT /:id/delivery-schedule — задать/изменить график поставки заказа (стадия forming)
  //   График ключуется по agg_key; сумма по каждому agg_key должна равняться количеству этого
  //   материала в заказе. График заявки при этом не трогается. REPLACE по переданным agg_key.
  // ============================================================
  fastify.put<{ Params: { id: string } }>('/:id/delivery-schedule', async (request, reply) => {
    const user = request.currentUser;
    const body = putOrderDeliveryScheduleSchema.parse(request.body);
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, created_by, row_version
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (user.role !== 'admin' && lot.created_by !== user.id) {
        await client.query('ROLLBACK');
        return reply.status(403).send({ error: 'Изменять график заказа может только его создатель или администратор' });
      }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ зафиксирован — график менять нельзя' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: lot.row_version });
      }

      const SCHED_EPS = 1e-6;
      const { rows: aggRows } = await client.query(
        `SELECT agg_key, SUM(quantity)::numeric AS qty FROM supplier_order_items WHERE order_id = $1 GROUP BY agg_key`,
        [lot.id],
      );
      const aggQty = new Map<string, number>(aggRows.map((a) => [a.agg_key as string, Number(a.qty)]));
      for (const line of body.schedule) {
        if (!aggQty.has(line.aggKey)) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'График задан по материалу вне состава заказа' });
        }
        const dates = line.entries.map((e) => e.deliveryDate);
        if (new Set(dates).size !== dates.length) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Даты поставки в графике не должны повторяться' });
        }
        const sum = line.entries.reduce((s, e) => s + e.quantity, 0);
        if (Math.abs(sum - (aggQty.get(line.aggKey) ?? 0)) > SCHED_EPS) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Сумма графика не совпадает с количеством материала в заказе' });
        }
      }

      await client.query(
        `DELETE FROM supplier_order_delivery_schedule WHERE order_id = $1 AND agg_key = ANY($2::text[])`,
        [lot.id, body.schedule.map((l) => l.aggKey)],
      );
      for (const line of body.schedule) {
        for (const e of line.entries) {
          await client.query(
            `INSERT INTO supplier_order_delivery_schedule (order_id, agg_key, delivery_date, quantity)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (order_id, agg_key, delivery_date) DO UPDATE SET quantity = EXCLUDED.quantity`,
            [lot.id, line.aggKey, e.deliveryDate, e.quantity],
          );
        }
      }

      await client.query('UPDATE supplier_orders SET row_version = row_version + 1, updated_at = now() WHERE id = $1', [lot.id]);
      await appendOrderAudit(client, { orderId: lot.id, action: 'delivery_schedule_updated', userId: user.id, projectId: lot.project_id });
      const { rows: fin } = await client.query('SELECT row_version FROM supplier_orders WHERE id = $1', [lot.id]);
      await client.query('COMMIT');
      return { data: { ok: true, rowVersion: fin[0].row_version } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // DELETE /:id — удалить формируемый лот целиком (позиции CASCADE)
  // ============================================================
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = request.currentUser;
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, created_by FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (user.role !== 'admin' && lot.created_by !== user.id) {
        await client.query('ROLLBACK');
        return reply.status(403).send({ error: 'Удалить заказ может только его создатель или администратор' });
      }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Удалить можно только формируемый заказ' });
      }
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [lot.id]);
      // Соберём ключи S3-объектов предложений до каскадного удаления (БД каскад файлы в S3 не чистит).
      const { rows: fileRows } = await client.query(
        `SELECT file_key FROM supplier_order_offers WHERE order_id = $1 AND file_key IS NOT NULL`, [lot.id],
      );
      await client.query('DELETE FROM supplier_orders WHERE id = $1', [lot.id]);
      await appendOrderAudit(client, { orderId: lot.id, action: 'deleted', userId: user.id, projectId: lot.project_id });
      for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, user.id);
      await client.query('COMMIT');
      if (fastify.storage) for (const f of fileRows) await fastify.storage.deleteObject(f.file_key).catch(() => {});
      return { data: { ok: true } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/cancel — отменить лот (cancel-saga).
  //   manual / тендер без выгрузки на портал → сразу cancelled (остаток освобождён);
  //   тендер выгружен (есть portal_id) → cancel_pending + надёжная команда tender.cancel в outbox
  //     (доставляется с ретраями; poller подтвердит 'cancelled' и освободит остаток);
  //   тендер в очереди на выгрузку (portal_id ещё нет, create в outbox) → cancel_pending +
  //     desired_tender_state='cancelled'; create-worker перечитает намерение и прервёт создание.
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const user = request.currentUser;
    const client = await fastify.pool.connect();
    let kick = false;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, procurement_method, tender_portal_id, tender_external_ref
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (['cancelled', 'cancel_pending', 'awarded', 'no_award'].includes(lot.sourcing_status)) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ уже нельзя отменить' });
      }

      const isTender = lot.procurement_method === 'tender';
      const { rows: createRows } = isTender
        ? await client.query(
            `SELECT 1 FROM integration_outbox WHERE aggregate_id = $1 AND command_type = 'tender.create'
               AND status IN ('queued','retry_wait','waiting_config') LIMIT 1`,
            [lot.id],
          )
        : { rows: [] as unknown[] };
      const createPending = createRows.length > 0;
      // Тендер «живёт» на портале либо ещё создаётся — держим остаток до подтверждения отмены.
      const holdForTender = isTender && (Boolean(lot.tender_portal_id) || createPending);
      const next = holdForTender ? 'cancel_pending' : 'cancelled';

      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = $2,
                desired_tender_state = CASE WHEN $3::boolean THEN 'cancelled' ELSE desired_tender_state END,
                tender_next_poll_at = CASE WHEN $4::boolean THEN now() ELSE tender_next_poll_at END,
                row_version = row_version + 1, updated_at = now()
          WHERE id = $1`,
        [lot.id, next, isTender, Boolean(lot.tender_portal_id)],
      );
      // Тендер уже на портале — ставим надёжную команду отмены (идемпотентно по partial-unique).
      if (lot.tender_portal_id) {
        const cancelPayload = JSON.stringify({ orderId: lot.id });
        const cancelHash = createHash('sha256').update(`tender.cancel:${lot.id}`).digest('hex');
        await client.query(
          `INSERT INTO integration_outbox
             (aggregate_type, aggregate_id, command_type, external_ref, payload, payload_hash, status, next_attempt_at)
           VALUES ('supplier_order', $1, 'tender.cancel', $2, $3::jsonb, $4, 'queued', now())
           ON CONFLICT (aggregate_id, command_type)
             WHERE command_type IN ('tender.create','tender.cancel')
               AND status IN ('queued','retry_wait','waiting_config')
           DO NOTHING`,
          [lot.id, lot.tender_external_ref, cancelPayload, cancelHash],
        );
        kick = true;
      } else if (createPending) {
        kick = true; // разбудить create-worker, чтобы он перечитал намерение и прервал создание
      }
      await appendOrderAudit(client, { orderId: lot.id, action: 'cancelled', userId: user.id, changes: { next }, projectId: lot.project_id });
      if (next === 'cancelled') {
        const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [lot.id]);
        for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, user.id);
      }
      await client.query('COMMIT');
      if (kick) fastify.outbox.kick();
      return { data: { id: lot.id, sourcingStatus: next } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/start — начать закупку: заморозить состав и выбрать канал.
  //   method='manual' — сбор КП по почте (Excel качается отдельно).
  //   method='tender' — выгрузка лота в тендерный портал (обрабатывается в POST /:id/tender).
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/start', async (request, reply) => {
    const user = request.currentUser;
    const body = startProcurementSchema.parse(request.body);
    if (body.method === 'tender') {
      return reply.status(400).send({ error: 'Для тендера используйте «Создать тендер»' });
    }
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, row_version FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ уже в закупке' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: lot.row_version });
      }
      const { rows: cnt } = await client.query('SELECT count(*)::int AS n FROM supplier_order_items WHERE order_id = $1', [lot.id]);
      if (cnt[0].n === 0) { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Заказ пуст' }); }
      await client.query(
        `UPDATE supplier_orders SET sourcing_status = 'sourcing', procurement_method = 'manual',
                row_version = row_version + 1, updated_at = now() WHERE id = $1`,
        [lot.id],
      );
      await appendOrderAudit(client, { orderId: lot.id, action: 'procurement_started', userId: user.id, changes: { method: 'manual' }, projectId: lot.project_id });
      await client.query('COMMIT');
      return { data: { id: lot.id, sourcingStatus: 'sourcing', method: 'manual' } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/tender — начать закупку через тендер: заморозить лот и поставить команду создания
  //   тендера в outbox (И5: портал вызывает ТОЛЬКО worker, синхронного вызова в маршруте нет).
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/tender', async (request, reply) => {
    const user = request.currentUser;
    const body = startProcurementSchema.parse(request.body);
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, title, order_no, sourcing_status, row_version
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ уже в закупке' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: lot.row_version });
      }
      // Условия тендера обязательны; дедлайн — ISO и строго в будущем (портал требует deadline_at).
      const tc = body.tender;
      if (!tc?.deadlineAt) { await client.query('ROLLBACK'); return reply.status(400).send({ error: 'Укажите дедлайн приёма ставок' }); }
      const deadline = new Date(tc.deadlineAt);
      if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Дедлайн приёма ставок должен быть в будущем' });
      }
      // Агрегированные позиции лота (без подрядчиков/№ заявок) — предмет тендера. Группировка по
      // agg_key (каноническая идентичность материала+ед.), чтобы разные материалы с одинаковым
      // названием не сливались. Количество — decimal-строка из SQL (не через JS Number).
      // Источник графика для спецификации — заданный снабжением график заказа (по agg_key),
      // с fallback на снимок дат заявки, если график по материалу не задан.
      const { rows: items } = await client.query(
        `WITH agg AS (
           SELECT agg_key, unit, MIN(material_name) AS material_name, SUM(quantity)::numeric AS quantity
             FROM supplier_order_items WHERE order_id = $1
            GROUP BY agg_key, unit
         ), snap AS (
           SELECT agg_key,
                  json_agg(json_build_object('date', delivery_date, 'qty', qty) ORDER BY delivery_date)
                    FILTER (WHERE delivery_date IS NOT NULL) AS schedule
             FROM (SELECT agg_key, delivery_date, SUM(quantity) AS qty
                     FROM supplier_order_items WHERE order_id = $1 GROUP BY agg_key, delivery_date) s
            GROUP BY agg_key
         ), newd AS (
           SELECT agg_key,
                  json_agg(json_build_object('date', delivery_date, 'qty', quantity) ORDER BY delivery_date) AS schedule
             FROM supplier_order_delivery_schedule WHERE order_id = $1 GROUP BY agg_key
         )
         SELECT a.material_name, a.unit, a.quantity,
                COALESCE(n.schedule, s.schedule) AS schedule
           FROM agg a
           LEFT JOIN newd n ON n.agg_key = a.agg_key
           LEFT JOIN snap s ON s.agg_key = a.agg_key
          ORDER BY a.material_name`,
        [lot.id],
      );
      if (items.length === 0) { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Заказ пуст' }); }

      // Единицы: сопоставляем со справочником портала; неизвестную не отправляем (блокируем выгрузку).
      const unmapped = [...new Set(items.filter((it) => mapTenderUnit(it.unit) == null).map((it) => it.unit as string))];
      if (unmapped.length) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: `Единицы не сопоставлены с тендерным справочником: ${unmapped.join(', ')}. Приведите единицы измерения перед выгрузкой.` });
      }
      // Количество — не более 3 знаков после запятой (масштаб портала numeric(18,3)); не округляем молча.
      const badQty = items.find((it) => (String(it.quantity).split('.')[1]?.length ?? 0) > 3);
      if (badQty) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: `Количество «${badQty.material_name}» имеет более 3 знаков после запятой — недопустимо для тендера` });
      }

      // График поставки материала → человекочитаемая спецификация позиции тендера.
      const fmtDate = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };
      const scheduleSpec = (schedule: { date: string; qty: number | string }[] | null): string | null =>
        schedule?.length
          ? 'График поставки: ' + schedule.map((s) => `к ${fmtDate(s.date)} — ${s.qty}`).join('; ')
          : null;
      const hasSchedule = items.some((it) => (it.schedule?.length ?? 0) > 0);

      const externalRef = `estimat:lot:${lot.id}`;
      const input = {
        title: lot.title ?? `Заказ поставщику № З-${String(lot.order_no ?? 0).padStart(3, '0')}`,
        external_ref: externalRef,
        source_revision: (lot.row_version ?? 0) + 1,
        deadline_at: tc.deadlineAt,
        vat_rate: tc.vatRate ?? 'vat20',
        items: items.map((it) => ({
          material: it.material_name,
          quantity: String(it.quantity),
          unit: mapTenderUnit(it.unit),
          spec: scheduleSpec(it.schedule),
        })),
        conditions: {
          delivery: tc.delivery ?? null,
          payment: tc.payment ?? null,
          deadline: tc.deadline ?? (hasSchedule ? 'По графику поставки (см. спецификацию позиций)' : null),
          place: tc.place ?? null,
        },
      };
      const payload = { orderId: lot.id, input };
      const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

      await client.query(
        `UPDATE supplier_orders
            SET procurement_method='tender', sourcing_status='sourcing', desired_tender_state='active',
                tender_external_ref=$2, tender_sync_status='pending', tender_deadline_at=$3,
                tender_last_error=NULL, row_version=row_version+1, updated_at=now()
          WHERE id=$1`,
        [lot.id, externalRef, tc.deadlineAt],
      );
      await client.query(
        `INSERT INTO integration_outbox
           (aggregate_type, aggregate_id, command_type, external_ref, payload, payload_hash, status, next_attempt_at)
         VALUES ('supplier_order', $1, 'tender.create', $2, $3::jsonb, $4, 'queued', now())`,
        [lot.id, externalRef, JSON.stringify(payload), payloadHash],
      );
      await appendOrderAudit(client, { orderId: lot.id, action: 'tender_requested', userId: user.id, projectId: lot.project_id });
      await client.query('COMMIT');
      fastify.outbox.kick();
      return reply.status(202).send({ data: { id: lot.id, pending: true, syncEnabled: config.tender.outboundEnabled } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/tender-refresh — ручной опрос результатов тендера с портала сейчас
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/tender-refresh', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT tender_portal_id FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
      [request.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Заказ не найден' });
    if (!rows[0].tender_portal_id) return reply.status(409).send({ error: 'Тендер по заказу не создан' });
    try {
      await refreshTenderLot(fastify, request.params.id);
      const { rows: fresh } = await fastify.pool.query(
        `SELECT tender_status, tender_results FROM supplier_orders WHERE id = $1`,
        [request.params.id],
      );
      return { data: { tenderStatus: fresh[0].tender_status, tenderResults: fresh[0].tender_results } };
    } catch (e) {
      if (e instanceof TenderNotConfiguredError) return reply.status(409).send({ error: 'Тендерный портал не настроен' });
      if (e instanceof TenderApiError) return reply.status(502).send({ error: e.message });
      throw e;
    }
  });

  // ============================================================
  // POST /:id/export — Excel «Запрос КП» (для рассылки поставщикам по почте)
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/export', async (request, reply) => {
    try {
      const { buffer, fileName } = await exportSupplierOrderXlsx(fastify.pool, request.params.id);
      await appendOrderAudit(fastify.pool, { orderId: request.params.id, action: 'kp_exported', userId: request.currentUser.id });
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      return reply.send(buffer);
    } catch (e) {
      if (e instanceof SupplierOrderExportError) return reply.status(e.status).send({ error: e.message });
      throw e;
    }
  });

  // Заказ доступен для работы с поставщиками: стадия сбора предложений (sourcing), не тендер.
  async function loadOfferableOrder(id: string) {
    const { rows } = await fastify.pool.query(
      `SELECT id, sourcing_status, procurement_method, project_id FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
      [id],
    );
    return rows[0] as { id: string; sourcing_status: string; procurement_method: string | null; project_id: string | null } | undefined;
  }

  // ============================================================
  // POST /:id/offers — добавить поставщика-предложение (manual, стадия сбора; сумма необязательна)
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/offers', async (request, reply) => {
    const user = request.currentUser;
    const body = upsertOfferSchema.parse(request.body);
    const order = await loadOfferableOrder(request.params.id);
    if (!order) return reply.status(404).send({ error: 'Заказ не найден' });
    if (!['forming', 'sourcing'].includes(order.sourcing_status) || order.procurement_method === 'tender') {
      return reply.status(409).send({ error: 'Поставщиков можно добавлять только по формируемому заказу или заказу в стадии сбора предложений' });
    }
    const { rows: ins } = await fastify.pool.query(
      `INSERT INTO supplier_order_offers
         (order_id, supplier_id, supplier_name, supplier_inn, amount, currency, response_status, terms, note, created_by)
       VALUES ($1,$2,$3,$4,$5,'RUB',$6,$7,$8,$9) RETURNING id`,
      [order.id, body.supplierId ?? null, body.supplierName, body.supplierInn ?? null, body.amount ?? null,
       body.responseStatus ?? 'pending', body.terms ?? null, body.note ?? null, user.id],
    );
    await appendOrderAudit(fastify.pool, { orderId: order.id, action: 'offer_added', userId: user.id, changes: { supplierName: body.supplierName }, projectId: order.project_id });
    return reply.status(201).send({ data: { id: ins[0].id } });
  });

  // PATCH /:id/offers/:offerId — правка поставщика (имя/ИНН/сумма/статус ответа), пока не оформлен.
  fastify.patch<{ Params: { id: string; offerId: string } }>('/:id/offers/:offerId', async (request, reply) => {
    const user = request.currentUser;
    const body = upsertOfferSchema.parse(request.body);
    const order = await loadOfferableOrder(request.params.id);
    if (!order) return reply.status(404).send({ error: 'Заказ не найден' });
    if (!['forming', 'sourcing'].includes(order.sourcing_status) || order.procurement_method === 'tender') {
      return reply.status(409).send({ error: 'Поставщиков можно менять только по формируемому заказу или заказу в стадии сбора предложений' });
    }
    const { rowCount } = await fastify.pool.query(
      `UPDATE supplier_order_offers
          SET supplier_id = $3, supplier_name = $4, supplier_inn = $5, amount = $6,
              response_status = COALESCE($7, response_status), terms = $8, note = $9
        WHERE id = $1 AND order_id = $2`,
      [request.params.offerId, order.id, body.supplierId ?? null, body.supplierName, body.supplierInn ?? null,
       body.amount ?? null, body.responseStatus ?? null, body.terms ?? null, body.note ?? null],
    );
    if (!rowCount) return reply.status(404).send({ error: 'Предложение не найдено' });
    return { data: { ok: true } };
  });

  // DELETE /:id/offers/:offerId — убрать поставщика (пока заказ не оформлен); S3-объект чистим.
  fastify.delete<{ Params: { id: string; offerId: string } }>('/:id/offers/:offerId', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT sourcing_status, procurement_method FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
      [request.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Заказ не найден' });
    if (!['forming', 'sourcing'].includes(rows[0].sourcing_status) || rows[0].procurement_method === 'tender') {
      return reply.status(409).send({ error: 'Убрать поставщика можно только по формируемому заказу или заказу в стадии сбора предложений' });
    }
    const { rows: del } = await fastify.pool.query(
      `DELETE FROM supplier_order_offers WHERE id = $1 AND order_id = $2 RETURNING file_key`,
      [request.params.offerId, request.params.id],
    );
    if (!del[0]) return reply.status(404).send({ error: 'Предложение не найдено' });
    if (del[0].file_key && fastify.storage) await fastify.storage.deleteObject(del[0].file_key).catch(() => {});
    return { data: { ok: true } };
  });

  // ============================================================
  // POST /:id/offers/:offerId/file — приложить документ поставщика (КП/счёт), потоковый multipart.
  //   Загрузка автоматически ставит статус ответа 'received'. Замена: новый объект → БД → удалить старый.
  // ============================================================
  fastify.post<{ Params: { id: string; offerId: string }; Querystring: { documentType?: string } }>(
    '/:id/offers/:offerId/file',
    async (request, reply) => {
      const user = request.currentUser;
      const order = await loadOfferableOrder(request.params.id);
      if (!order) return reply.status(404).send({ error: 'Заказ не найден' });
      if (order.sourcing_status !== 'sourcing' || order.procurement_method === 'tender') {
        return reply.status(409).send({ error: 'Документы поставщиков — только по заказу в стадии сбора предложений' });
      }
      if (!fastify.storage) return reply.status(503).send({ error: 'Хранилище файлов не настроено' });
      const { documentType } = offerFileMetaSchema.parse({ documentType: request.query.documentType });
      const { rows: oRows } = await fastify.pool.query(
        `SELECT id, file_key FROM supplier_order_offers WHERE id = $1 AND order_id = $2`,
        [request.params.offerId, order.id],
      );
      if (!oRows[0]) return reply.status(404).send({ error: 'Предложение не найдено' });
      const prevKey: string | null = oRows[0].file_key;

      const file = await request.file({ limits: { fileSize: FILE_LIMIT } });
      if (!file) return reply.status(400).send({ error: 'Файл не загружен' });
      try {
        const meta = await guardedStreamUpload(fastify.storage, file.file, file.filename, `supplier-orders/${order.id}/offers`);
        if (file.file.truncated) {
          await fastify.storage.deleteObject(meta.key);
          return reply.status(400).send({ error: 'Файл больше 50 МБ' });
        }
        try {
          await fastify.pool.query(
            `UPDATE supplier_order_offers
                SET file_key = $3, file_name = $4, mime_type = $5, checksum = $6, file_size = $7,
                    document_type = $8, response_status = 'received'
              WHERE id = $1 AND order_id = $2`,
            [request.params.offerId, order.id, meta.key, meta.safeName, meta.mime, meta.checksum, meta.size, documentType],
          );
        } catch (dbErr) {
          await fastify.storage.deleteObject(meta.key).catch(() => {});
          throw dbErr;
        }
        // Успешная замена — удаляем прежний объект.
        if (prevKey && prevKey !== meta.key) await fastify.storage.deleteObject(prevKey).catch(() => {});
        await appendOrderAudit(fastify.pool, { orderId: order.id, action: 'offer_file_added', userId: user.id, changes: { documentType, fileName: meta.safeName }, projectId: order.project_id });
        return reply.status(201).send({ data: { fileName: meta.safeName, documentType } });
      } catch (e) {
        if (e instanceof FileGuardError) return reply.status(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // GET /:id/offers/:offerId/file — download-proxy документа поставщика (S3-ключ наружу не отдаём).
  fastify.get<{ Params: { id: string; offerId: string } }>('/:id/offers/:offerId/file', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT file_key, file_name, mime_type FROM supplier_order_offers WHERE id = $1 AND order_id = $2`,
      [request.params.offerId, request.params.id],
    );
    const f = rows[0];
    if (!f || !f.file_key || !fastify.storage) return reply.status(404).send({ error: 'Файл не найден' });
    const obj = await fastify.storage.getObject(f.file_key);
    reply.type(f.mime_type || 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (obj.contentLength != null) reply.header('Content-Length', obj.contentLength);
    reply.header('Content-Disposition', `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.file_name || 'file')}`);
    return reply.send(obj.body);
  });

  // ============================================================
  // POST /:id/award — зафиксировать поставщика (одна атомарная операция; И5).
  //   manual — по выбранному КП (сумму/поставщика берёт сервер из КП; только RUB).
  //   tender — по победителю площадки (сервер резолвит ставку/сумму из tender_results; тендер finished).
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/award', async (request, reply) => {
    const user = request.currentUser;
    const body = awardSchema.parse(request.body);
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (lot.sourcing_status !== 'sourcing') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Присудить можно только заказ в стадии закупки' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: lot.row_version });
      }

      let supplierName: string;
      let supplierInn: string | null = null;
      let supplierId: string | null = null;
      let amount: string; // decimal-строка (без потери точности через JS Number)
      let quoteId: string | null = null;

      if (body.source === 'manual') {
        if (lot.procurement_method !== 'manual') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Заказ закупается через тендер' }); }
        if (!body.quoteId) { await client.query('ROLLBACK'); return reply.status(400).send({ error: 'Не выбрано КП' }); }
        const { rows: oRows } = await client.query(
          `SELECT * FROM supplier_order_offers WHERE id = $1 AND order_id = $2`,
          [body.quoteId, lot.id],
        );
        const offer = oRows[0];
        if (!offer) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'КП не найдено' }); }
        if (offer.currency !== 'RUB') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Валюта КП не поддерживается (только RUB)' }); }
        supplierName = offer.supplier_name;
        supplierInn = offer.supplier_inn;
        supplierId = offer.supplier_id;
        amount = String(offer.amount);
        quoteId = offer.id;
      } else {
        // tender: победитель определён площадкой; сервер резолвит ставку из сохранённых результатов.
        if (lot.procurement_method !== 'tender') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Заказ закупается по почте' }); }
        if (lot.tender_status !== 'finished') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Тендер ещё не завершён' }); }
        const results = lot.tender_results as {
          outcome?: string | null;
          participants?: { id: string; name: string; inn?: string | null }[];
          bids?: { participant_id: string; bid_id?: string | null; amount: string; currency?: string | null }[];
          winner?: { participant_id: string; bid_id?: string | null; bid_index?: number | null } | null;
        } | null;
        if (results?.outcome === 'no_award') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Тендер завершён без победителя' }); }
        const portalWinner = results?.winner?.participant_id;
        if (!portalWinner) { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Победитель тендера не определён' }); }
        // Подтверждаем именно победителя площадки (клиент не может назначить произвольного участника).
        if (body.winnerParticipantId && body.winnerParticipantId !== portalWinner) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Победителя тендера определяет площадка' });
        }
        const participant = results?.participants?.find((p) => p.id === portalWinner);
        // Ставку победителя ищем по bid_id (надёжнее), затем по bid_index, иначе — минимальная его ставка.
        const winnerBidId = results?.winner?.bid_id;
        const bidIdx = results?.winner?.bid_index;
        const bid =
          (winnerBidId && results?.bids?.find((b) => b.bid_id === winnerBidId)) ||
          (bidIdx != null && results?.bids?.[bidIdx]?.participant_id === portalWinner ? results.bids[bidIdx] : undefined) ||
          results?.bids?.filter((b) => b.participant_id === portalWinner).sort((a, b) => Number(a.amount) - Number(b.amount))[0];
        if (!participant || !bid) { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Ставка победителя не найдена в результатах' }); }
        if (bid.currency && bid.currency !== 'RUB') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Валюта ставки не поддерживается (только RUB)' }); }
        supplierName = participant.name;
        supplierInn = participant.inn ?? null;
        amount = String(bid.amount);
      }

      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = 'awarded', supplier_name = $2, supplier_inn = $3, supplier_id = $4,
                amount = $5, award_source = $6, awarded_quote_id = $7, awarded_at = now(), awarded_by = $8,
                row_version = row_version + 1, updated_at = now()
          WHERE id = $1`,
        [lot.id, supplierName, supplierInn, supplierId, amount, body.source, quoteId, user.id],
      );
      await appendOrderAudit(client, {
        orderId: lot.id, action: 'awarded', userId: user.id,
        changes: { source: body.source, supplierName, amount }, projectId: lot.project_id,
      });
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [lot.id]);
      for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, user.id);
      await client.query('COMMIT');
      return { data: { id: lot.id, sourcingStatus: 'awarded', supplierName, amount } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/finalize — оформить победителя с ценами (manual): sourcing → awarded (атомарно).
  //   Победитель — предложение с ответом 'received' и приложенным документом. Цены вводятся ПО АГРЕГАТУ
  //   материала (agg_key). Итог считается в SQL numeric (построчное округление до копеек), amount = ИТОГО > 0.
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/finalize', async (request, reply) => {
    const user = request.currentUser;
    const body = finalizeOrderSchema.parse(request.body);
    const aggKeys = body.lines.map((l) => l.aggKey);
    if (new Set(aggKeys).size !== aggKeys.length) {
      return reply.status(400).send({ error: 'Дублирующиеся материалы в ценах' });
    }
    const rate = MANUAL_VAT_RATE_VALUE[body.vatRate as ManualVatRate];

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, procurement_method, row_version FROM supplier_orders
          WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const order = rows[0];
      if (!order) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (order.sourcing_status !== 'sourcing' || order.procurement_method === 'tender') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Оформить можно только заказ в стадии сбора предложений' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== order.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: order.row_version });
      }

      // Победитель: принадлежит заказу, ответ получен, документ приложен.
      const { rows: wRows } = await client.query(
        `SELECT id, supplier_id, supplier_name, supplier_inn, response_status, file_key
           FROM supplier_order_offers WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [body.winnerOfferId, order.id],
      );
      const winner = wRows[0];
      if (!winner) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Победитель не найден' }); }
      if (winner.response_status !== 'received' || !winner.file_key) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Победителем можно выбрать только поставщика с полученным предложением и приложенным документом' });
      }

      // Цены должны покрывать ВСЕ агрегаты заказа (точное совпадение множеств agg_key).
      const { rows: orderKeys } = await client.query(
        `SELECT DISTINCT agg_key FROM supplier_order_items WHERE order_id = $1`,
        [order.id],
      );
      const orderSet = new Set(orderKeys.map((r) => r.agg_key as string));
      if (orderSet.size !== aggKeys.length || aggKeys.some((k) => !orderSet.has(k))) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Заполните цены по всем материалам заказа' });
      }

      // Записываем цены победителя по агрегату.
      await client.query('DELETE FROM supplier_order_price_lines WHERE order_id = $1', [order.id]);
      await client.query(
        `INSERT INTO supplier_order_price_lines (order_id, agg_key, unit_price, warranty_months)
         SELECT $1, k, p, w FROM unnest($2::text[], $3::numeric[], $4::int[]) AS t(k, p, w)`,
        [order.id, aggKeys, body.lines.map((l) => l.unitPrice), body.lines.map((l) => l.warrantyMonths ?? null)],
      );

      // ИТОГО в SQL numeric: построчно net=ROUND(кол-во×цена,2), НДС=ROUND(net×ставка,2), итого=net+НДС.
      const { rows: totRows } = await client.query(
        `WITH agg AS (
           SELECT agg_key, SUM(quantity) AS qty FROM supplier_order_items WHERE order_id = $1 GROUP BY agg_key
         ), line AS (
           SELECT ROUND(a.qty * pl.unit_price, 2) AS net
             FROM agg a JOIN supplier_order_price_lines pl ON pl.order_id = $1 AND pl.agg_key = a.agg_key
         )
         SELECT COALESCE(SUM(net + ROUND(net * $2::numeric, 2)), 0)::numeric(15,2) AS total FROM line`,
        [order.id, rate],
      );
      const amount: string = String(totRows[0].total);
      if (Number(amount) <= 0) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Итоговая сумма заказа должна быть больше нуля' });
      }

      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = 'awarded', vat_rate = $2, payment_type = $3,
                supplier_id = $4, supplier_name = $5, supplier_inn = $6, amount = $7,
                award_source = 'manual', awarded_quote_id = $8, awarded_at = now(), awarded_by = $9,
                row_version = row_version + 1, updated_at = now()
          WHERE id = $1`,
        [order.id, body.vatRate, body.paymentType, winner.supplier_id, winner.supplier_name, winner.supplier_inn,
         amount, winner.id, user.id],
      );
      await appendOrderAudit(client, {
        orderId: order.id, action: 'finalized', userId: user.id,
        changes: { vatRate: body.vatRate, paymentType: body.paymentType, amount, supplierName: winner.supplier_name },
        projectId: order.project_id,
      });
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [order.id]);
      for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, user.id);
      await client.query('COMMIT');
      return { data: { id: order.id, sourcingStatus: 'awarded', amount, supplierName: winner.supplier_name } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // GET /registry — единый реестр закупок (4 вида: заказ поставщику / тендер / заказ по РП / заказ
  //   поставщиком). Один скан supplier_orders (kind='sourcing' + kind='direct' JOIN заявок). Read-only.
  // ============================================================
  fastify.get<{ Querystring: { projectId?: string; type?: string; limit?: string; offset?: string; all?: string } }>('/registry', async (request) => {
    const q = request.query;
    const projectId = q.projectId || null;
    const types = q.type ? q.type.split(',').map((s) => s.trim()).filter(Boolean) : null;
    // all=1 — весь набор для отборов/дерева на клиенте (потолок + meta.truncated, как в /materials).
    const REGISTRY_ALL_CAP = 5000;
    const groupAll = q.all === '1';
    const limit = groupAll ? REGISTRY_ALL_CAP : Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const offset = groupAll ? 0 : Math.max(Number(q.offset) || 0, 0);

    const { rows } = await fastify.pool.query(
      `WITH reg AS (
         SELECT
           CASE WHEN so.procurement_method = 'tender' THEN 'tender' ELSE 'supplier_order' END AS kind_tag,
           so.id, 'order'::text AS link_kind, so.project_id, so.project_name,
           'З-' || lpad(COALESCE(so.order_no, 0)::text, 3, '0') AS number,
           so.supplier_name, so.amount, so.sourcing_status AS status,
           so.tender_status, so.tender_url, so.created_at, so.created_by,
           COALESCE(soc.names, '{}')::text[] AS contractors
           FROM supplier_orders so
           -- Подрядчики заказа: у sourcing-заказа их может быть несколько (позиции из разных
           -- заявок). LATERAL, а не предагрегация с GROUP BY: коррелированный подзапрос идёт по
           -- ведущему столбцу ux_soi_order_request_item(order_id, request_item_id).
           LEFT JOIN LATERAL (
             SELECT array_agg(DISTINCT soi.contractor_name ORDER BY soi.contractor_name) AS names
               FROM supplier_order_items soi
              WHERE soi.order_id = so.id AND soi.contractor_name IS NOT NULL
           ) soc ON true
          WHERE so.kind = 'sourcing'
         UNION ALL
         SELECT
           CASE WHEN mr.request_type = 'own_supplier' THEN 'rp_order' ELSE 'direct_order' END AS kind_tag,
           mr.id, 'request'::text AS link_kind, mr.project_id, mr.project_name,
           COALESCE(p.code, '') || '-' || lpad(COALESCE(mr.request_no, 0)::text, 2, '0') AS number,
           so.supplier_name, so.amount, mr.status,
           NULL::text AS tender_status, NULL::text AS tender_url, so.created_at, NULL::uuid AS created_by,
           CASE WHEN mr.contractor_name IS NULL THEN '{}'::text[] ELSE ARRAY[mr.contractor_name] END AS contractors
           FROM supplier_orders so
           JOIN material_requests mr ON mr.id = so.request_id
           LEFT JOIN projects p ON p.id = mr.project_id
          WHERE so.kind = 'direct'
            AND mr.request_type IN ('own_supplier', 'own_supply')
            AND mr.status <> 'cancelled'
       )
       SELECT reg.*, count(*) OVER() AS total
         FROM reg
        WHERE ($1::uuid IS NULL OR reg.project_id = $1)
          AND ($2::text[] IS NULL OR reg.kind_tag = ANY($2))
        ORDER BY reg.created_at DESC
        LIMIT $3 OFFSET $4`,
      [projectId, types, limit, offset],
    );
    const total = rows[0] ? Number(rows[0].total) : 0;
    return { data: rows.map(({ total: _t, ...r }) => r), meta: { total, truncated: groupAll && total > rows.length } };
  });

  // ============================================================
  // GET / — реестр лотов (фильтр по объекту/стадии, пагинация)
  // ============================================================
  fastify.get<{ Querystring: { projectId?: string; status?: string; limit?: string; offset?: string } }>('/', async (request) => {
    const q = request.query;
    const values: unknown[] = [];
    const where: string[] = [`so.kind = 'sourcing'`];
    if (q.projectId) { values.push(q.projectId); where.push(`so.project_id = $${values.length}`); }
    if (q.status) {
      const st = q.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (st.length) { values.push(st); where.push(`so.sourcing_status = ANY($${values.length}::text[])`); }
    }
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const offset = Math.max(Number(q.offset) || 0, 0);
    values.push(limit, offset);

    const { rows } = await fastify.pool.query(
      `SELECT so.id, so.order_no, so.title, so.project_id, so.project_name,
              so.sourcing_status, so.procurement_method, so.supplier_name, so.supplier_inn, so.amount,
              so.tender_status, so.tender_url, so.tender_sync_status, so.awarded_at, so.created_at, so.row_version,
              (SELECT count(*) FROM supplier_order_items i WHERE i.order_id = so.id) AS items_count,
              (SELECT count(DISTINCT i.request_id) FROM supplier_order_items i WHERE i.order_id = so.id) AS requests_count,
              count(*) OVER() AS total
         FROM supplier_orders so
        WHERE ${where.join(' AND ')}
        ORDER BY so.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const total = rows[0] ? Number(rows[0].total) : 0;
    return { data: rows, meta: { total } };
  });

  // ============================================================
  // GET /by-request/:requestId — лоты, в которые вошли позиции заявки + сводка покрытия
  //   (для секции «Закупочные лоты» в карточке su10-заявки).
  // ============================================================
  fastify.get<{ Params: { requestId: string } }>('/by-request/:requestId', async (request) => {
    const rid = request.params.requestId;
    const [lots, cov, mats] = await Promise.all([
      fastify.pool.query(
        `SELECT so.id, so.order_no, so.title, so.sourcing_status, so.procurement_method, so.tender_status,
                so.tender_url, so.supplier_name, so.amount,
                COALESCE(SUM(soi.quantity), 0)::numeric AS qty
           FROM supplier_orders so
           JOIN supplier_order_items soi ON soi.order_id = so.id AND soi.request_id = $1
          WHERE so.kind = 'sourcing'
          GROUP BY so.id
          ORDER BY so.order_no`,
        [rid],
      ),
      fastify.pool.query(
        `SELECT
           (SELECT project_id FROM material_requests WHERE id = $1) AS project_id,
           (SELECT COALESCE(SUM(quantity),0) FROM material_request_items WHERE request_id = $1)::numeric AS requested,
           (SELECT COALESCE(SUM(soi.quantity),0) FROM supplier_order_items soi
              JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status NOT IN ('cancelled','no_award')
             WHERE soi.request_id = $1)::numeric AS placed,
           (SELECT COALESCE(SUM(soi.quantity),0) FROM supplier_order_items soi
              JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status = 'awarded'
             WHERE soi.request_id = $1)::numeric AS awarded`,
        [rid],
      ),
      // Позиции самой заявки в формате свода (для «Сформировать лот» прямо из карточки).
      fastify.pool.query(
        `SELECT mri.id AS request_item_id, mri.request_id, mr.request_no, mr.request_type, mr.status,
                mr.project_id, mr.project_name, p.code AS project_code,
                mri.cost_type_id, ct.name AS cost_type_name,
                cc.id AS category_id, cc.name AS category_name,
                cc.sort_order AS category_sort, ct.sort_order AS cost_type_sort,
                mri.material_id, mri.material_name, mri.unit, mri.agg_key,
                mri.quantity::numeric AS requested, COALESCE(placed.qty, 0)::numeric AS ordered,
                mr.contractor_id, mr.contractor_name
           FROM material_request_items mri
           JOIN material_requests mr ON mr.id = mri.request_id
                AND mr.request_type = 'su10' AND mr.status <> 'cancelled'
           LEFT JOIN projects p ON p.id = mr.project_id
           LEFT JOIN cost_types ct ON ct.id = mri.cost_type_id
           LEFT JOIN cost_categories cc ON cc.id = ct.category_id
           LEFT JOIN (
             SELECT soi.request_item_id, SUM(soi.quantity) AS qty
               FROM supplier_order_items soi
               JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status NOT IN ('cancelled','no_award')
              GROUP BY soi.request_item_id
           ) placed ON placed.request_item_id = mri.id
          WHERE mri.request_id = $1
          ORDER BY cc.sort_order NULLS LAST, ct.sort_order NULLS LAST, mri.material_name`,
        [rid],
      ),
    ]);
    const { project_id, ...coverage } = cov.rows[0] ?? {};
    const materials = mats.rows.map((r) => ({ ...r, remaining: Number(r.requested) - Number(r.ordered) }));
    return { data: { lots: lots.rows, coverage, projectId: project_id ?? null, materials } };
  });

  // ============================================================
  // GET /:id — карточка заказа (позиции, агрегаты, заявки-источники, поставщики-предложения, цены, тендер)
  // ============================================================
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT * FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
      [request.params.id],
    );
    const lot = rows[0];
    if (!lot) return reply.status(404).send({ error: 'Заказ не найден' });

    const [items, aggItems, sources, offers, priceLines, deliverySchedule] = await Promise.all([
      fastify.pool.query(
        `SELECT id, request_id, request_item_id, material_id, material_name, unit, quantity, agg_key,
                contractor_id, contractor_name, request_no, cost_type_name, cost_category_name,
                to_char(delivery_date, 'YYYY-MM-DD') AS delivery_date
           FROM supplier_order_items WHERE order_id = $1
          ORDER BY cost_category_name, cost_type_name, material_name, delivery_date NULLS LAST`,
        [lot.id],
      ),
      // Агрегаты материалов по agg_key — финансовые строки оформления (как в Excel КП и тендере).
      fastify.pool.query(
        `SELECT agg_key, MIN(material_name) AS material_name, unit, SUM(quantity)::numeric AS quantity,
                MIN(cost_category_name) AS cost_category_name
           FROM supplier_order_items WHERE order_id = $1
          GROUP BY agg_key, unit ORDER BY MIN(cost_category_name) NULLS LAST, MIN(material_name)`,
        [lot.id],
      ),
      fastify.pool.query(
        `SELECT DISTINCT i.request_id, i.request_no, mr.contractor_name, mr.status
           FROM supplier_order_items i JOIN material_requests mr ON mr.id = i.request_id
          WHERE i.order_id = $1`,
        [lot.id],
      ),
      fastify.pool.query(
        `SELECT id, supplier_id, supplier_name, supplier_inn, amount, currency, response_status, document_type,
                terms, note, (file_key IS NOT NULL) AS has_file, file_name, created_at
           FROM supplier_order_offers WHERE order_id = $1 ORDER BY response_status, amount NULLS LAST, created_at`,
        [lot.id],
      ),
      fastify.pool.query(
        `SELECT agg_key, unit_price, warranty_months FROM supplier_order_price_lines WHERE order_id = $1`,
        [lot.id],
      ),
      fastify.pool.query(
        `SELECT agg_key, to_char(delivery_date, 'YYYY-MM-DD') AS delivery_date, quantity::numeric AS quantity
           FROM supplier_order_delivery_schedule WHERE order_id = $1
          ORDER BY agg_key, delivery_date`,
        [lot.id],
      ),
    ]);
    return {
      data: {
        ...lot,
        items: items.rows,
        aggItems: aggItems.rows,
        sources: sources.rows,
        offers: offers.rows,
        priceLines: priceLines.rows,
        deliverySchedule: deliverySchedule.rows,
      },
    };
  });
}
