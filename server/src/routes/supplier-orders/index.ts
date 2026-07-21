import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  formLotSchema, startProcurementSchema, awardSchema, mapTenderUnit,
  upsertOfferSchema, offerFileMetaSchema, finalizeOrderSchema,
  approveOrderSchema, rejectApprovalSchema,
  putOrderDeliveryScheduleSchema, patchOrderCommentSchema,
  cancelOrderSchema, revokeAwardSchema, patchOrderItemSchema, deleteOrderItemSchema,
  assignMaterialResponsibleSchema, bulkAssignMaterialResponsibleSchema,
  setMaterialResponsiblesSchema, bulkSetMaterialResponsiblesSchema,
  type ManualVatRate,
} from '@estimat/shared';
import { config } from '../../config.js';
import { recalcRequestStatus } from '../../lib/requests/status-recalc.js';
import { recordAudit } from '../../lib/audit.js';
import { appendOrderAudit } from '../../lib/supplier-orders/helpers.js';
import { recalcOrderAmount } from '../../lib/supplier-orders/pricing.js';
import { replaceSchedule, reconcileScheduleAfterQtyChange, dropScheduleForAgg } from '../../lib/supplier-orders/schedule.js';
import { assertRemainingFits } from '../../lib/supplier-orders/allocation.js';
import supplierOrderInvoiceRoutes from './invoices.js';
import { assertOrderAccess, assertOrderAccessForOrder, decideOrderAccess } from '../../lib/procurement/access.js';
import { resolveResponsibles, scopeKey } from '../../lib/procurement/responsibles.js';
import { PROCUREMENT_ASSIGN_ROLES, type Role } from '@estimat/shared';
import type { Pool, PoolClient } from 'pg';
import { exportSupplierOrderXlsx, SupplierOrderExportError } from '../../lib/supplier-order-export/index.js';
import { refreshTenderLot } from '../../lib/tender/sync.js';
import { TenderApiError, TenderNotConfiguredError } from '../../lib/tender/errors.js';
import { guardedStreamUpload, FileGuardError } from '../../lib/uploads/file-guard.js';

const FILE_LIMIT = 50 * 1024 * 1024; // 50 МБ на файл предложения
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Кандидат в ответственные: активен и во внутренней роли.
type PoolClientLike = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
async function assertAssignableUser(client: PoolClientLike, userId: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM users
      WHERE id = $1 AND is_active = true AND role IN ('admin','engineer','manager')`,
    [userId],
  );
  return rows.length > 0;
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

  // Счета заказа — отдельным файлом (0078): index.ts и без них почти 1900 строк.
  // Префикс и хуки авторизации наследуются от этого роутера.
  await fastify.register(supplierOrderInvoiceRoutes);

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
      withZeroRemaining?: string;
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

    // Полностью заказанные строки по умолчанию скрыты: свод снабжения — рабочий список того, что
    // ещё предстоит заказать. Отбор серверный, а не клиентский, потому что он включён почти всегда:
    // на клиенте он либо исказил бы meta.total и номера страниц, либо потребовал бы грузить весь
    // набор (all=1) каждому пользователю.
    const withZeroRemaining = q.withZeroRemaining === '1';
    const dataValues = [...values, withZeroRemaining, limit, offset];
    // Схлопывание строк: одна строка на область «объект + подрядчик + вид затрат + материал»
    // (плюс тип заявки, чтобы давальческие и подрядные не склеивались). Исходные позиции
    // развёрнуты по датам поставки (0060), из-за чего один материал давал N строк.
    //
    // Агрегируем ДО LIMIT/OFFSET: клиентское схлопывание исказило бы meta.total и номера страниц.
    // COUNT(*) OVER() после GROUP BY считает уже схлопнутые строки, поэтому total остаётся верным.
    //
    // ОТВЕТСТВЕННЫЕ ЗДЕСЬ НЕ ДЖОЙНЯТСЯ. Раньше все три уровня и замещение подмешивались в base,
    // то есть ДО схлопывания и на каждой дате поставки: любой джойн кратности >1 (два активных
    // замещения одного человека) удваивал SUM(requested)/SUM(placed), а четыре независимых MIN()
    // могли вернуть id одного человека и фамилию другого. Резолв вынесен ПОСЛЕ агрегации —
    // одним вызовом resolveResponsibles по ключам уже схлопнутых строк. Так умножение объёмов
    // ответственными невозможно конструктивно, а не по договорённости.
    const { rows } = await fastify.pool.query(
      `WITH base AS (
         SELECT mri.id AS request_item_id, mri.request_id, mr.request_no, mr.request_type, mr.status,
                mr.project_id, mr.project_name, p.code AS project_code,
                mri.cost_type_id, ct.name AS cost_type_name,
                cc.id AS category_id, cc.name AS category_name,
                cc.sort_order AS category_sort, ct.sort_order AS cost_type_sort,
                mri.material_id, mri.material_name, mri.unit, mri.agg_key,
                to_char(mri.delivery_date, 'YYYY-MM-DD') AS delivery_date,
                mri.quantity::numeric AS requested, COALESCE(placed.qty, 0)::numeric AS placed,
                mr.contractor_id, mr.contractor_name
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
       )
       SELECT project_id, project_name, project_code, contractor_id, contractor_name,
              cost_type_id, cost_type_name, category_id, category_name, category_sort, cost_type_sort,
              unit, agg_key, request_type,
              -- Имя и id материала берём MIN: при текстовом agg_key регистр и пробелы в разных
              -- заявках могут различаться, ключ при этом один (та же идиома, что в GET /:id).
              MIN(material_name) AS material_name,
              MIN(material_id::text)::uuid AS material_id,
              SUM(requested)::numeric AS requested,
              SUM(placed)::numeric   AS placed,
              -- Остаток к заказу считаем ПО ПОЗИЦИЯМ, а не как разницу сумм: после разрешения
              -- правки объёмов одна дата может быть перезаказана, другая — недозаказана, и
              -- простая разница взаимно погасила бы их, показав «заказывать нечего».
              SUM(GREATEST(requested - placed, 0))::numeric AS available,
              SUM(GREATEST(placed - requested, 0))::numeric AS overplaced,
              json_agg(json_build_object(
                'request_item_id', request_item_id, 'request_id', request_id, 'request_no', request_no,
                'delivery_date', delivery_date, 'requested', requested, 'placed', placed
              ) ORDER BY delivery_date NULLS LAST, request_item_id) AS items,
              COUNT(*) OVER() AS total_count
         FROM base
        GROUP BY project_id, project_name, project_code, contractor_id, contractor_name,
                 cost_type_id, cost_type_name, category_id, category_name, category_sort, cost_type_sort,
                 unit, agg_key, request_type
        -- Отсев полностью заказанных строк. Здесь, а не на клиенте: COUNT(*) OVER() считается ПОСЛЕ
        -- HAVING, поэтому meta.total и номера страниц остаются верными без единой дополнительной
        -- строки кода. Два исключения обязательны:
        --   • не-su10 заявки — размещение к ним не применяется, remaining=null («не применяется»);
        --   • перезаказ — это аномалия с красным тегом в таблице, и её нельзя прятать по умолчанию
        --     (после правки объёмов заявки remaining обнуляется, а разобраться со строкой надо).
        HAVING ($${values.length + 1}::boolean IS TRUE
                OR request_type <> 'su10'
                OR SUM(GREATEST(requested - placed, 0)) > 0
                OR SUM(GREATEST(placed - requested, 0)) > 0)
        ORDER BY project_name NULLS LAST, category_sort NULLS LAST, cost_type_sort NULLS LAST,
                 MIN(material_name)
        LIMIT $${values.length + 2} OFFSET $${values.length + 3}`,
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

    // Ответственные — одним запросом по областям уже схлопнутых строк. resolveResponsibles сам
    // дедуплицирует области: разные типы заявок с одним материалом делят одно назначение.
    const responsibles = await resolveResponsibles(
      fastify.pool,
      rows.map((r) => ({
        projectId: r.project_id, contractorId: r.contractor_id,
        costTypeId: r.cost_type_id, aggKey: r.agg_key,
      })),
    );

    return {
      data: rows.map(({ total_count, placed, available, overplaced, items, ...r }) => {
        const isSu10 = r.request_type === 'su10';
        const resp = responsibles.get(scopeKey({
          projectId: r.project_id, contractorId: r.contractor_id,
          costTypeId: r.cost_type_id, aggKey: r.agg_key,
        }));
        const respAssignedId = resp?.assignedUserId ?? null;
        const respEffectiveId = resp?.effectiveUserId ?? null;
        const list = (items ?? []) as { request_item_id: string; request_id: string; request_no: number | null }[];
        // Право вести заказ считает ТОТ ЖЕ предикат, что и мутации, а не его пересказ: копия
        // правила, стоявшая здесь, признавала оверрайд только за admin, и руководитель вне своей
        // зоны получал can_order = false — строку нельзя было отметить, хотя сама мутация его
        // пропускала. Теперь расхождение невозможно конструктивно.
        const canOrder = decideOrderAccess({
          role: request.currentUser.role,
          userId: request.currentUser.id,
          verdicts: [{ assignedUserId: respAssignedId, effectiveUserId: respEffectiveId }],
          hasScopeWithoutCostType: r.cost_type_id == null,
        }).ok;
        // Заявки схлопнутой строки: столбец «Заявка» стал многозначным.
        const seen = new Map<string, { id: string; no: number | null }>();
        for (const it of list) if (!seen.has(it.request_id)) seen.set(it.request_id, { id: it.request_id, no: it.request_no });
        return {
          ...r,
          // Стабильный ключ строки таблицы, заменяет request_item_id. Тип заявки входит в ключ,
          // потому что входит в GROUP BY: без него давальческая и подрядная строки одного
          // материала получали ОДИН ключ — React путал их при выделении и раскрытии.
          // Область ответственного при этом типа заявки не содержит намеренно: один материал на
          // объекте у подрядчика — один ответственный, независимо от того, как заявлен.
          row_key: [r.project_id ?? '', r.contractor_id ?? '', r.cost_type_id ?? '', r.agg_key, r.request_type ?? ''].join('|'),
          items: list,
          requests: [...seen.values()],
          ordered: isSu10 ? Number(placed) : null,
          // remaining — «сколько ещё можно заказать»: считается по позициям, поэтому перезаказ
          // по одной дате не гасит недозаказ по другой.
          remaining: isSu10 ? Number(available) : null,
          overplaced: isSu10 ? Number(overplaced) : 0,
          has_overplaced: isSu10 && Number(overplaced) > 0,
          can_order: canOrder,
          responsible: respEffectiveId
            ? { id: respEffectiveId, full_name: resp?.effectiveName ?? null, source: resp?.source ?? null }
            : null,
        };
      }),
      // truncated — «набор УСЕЧЁН потолком», а не «есть следующая страница»: флаг гейтит массовые
      // операции, которым нужен полный набор. В постраничном режиме total > rows.length всегда,
      // поэтому без groupAll флаг блокировал бы назначение ответственных на любой выборке крупнее
      // страницы. Тот же guard стоит в GET /registry.
      meta: { total, limit, offset, truncated: groupAll && total > rows.length, facets: facetRows[0] },
    };
  });

  // ============================================================
  // Ответственный за материал (уровень области, 0071)
  //   Назначение живёт по области «объект + подрядчик + вид затрат + материал», а НЕ на строке
  //   заявки: одна связка — один ответственный, и правило автоматически действует на все даты
  //   поставки материала и на будущие заявки с ним же. Снятие возвращает наследование от вида
  //   затрат или категории (справочник «Закупки»).
  //   Назначать может только manager/admin — как и подтверждать поставщика.
  // ============================================================
  const canAssignResponsible = requireRole(...PROCUREMENT_ASSIGN_ROLES);

  /**
   * Операции над УЖЕ ПРИСУЖДЁННЫМ заказом (смена поставщика, правка состава): их принимает тот же,
   * кто подтверждает поставщика — отменяется его собственное решение.
   */
  const canManageAwarded = requireRole(...PROCUREMENT_ASSIGN_ROLES);

  /**
   * Можно ли менять состав заказа на этой стадии и этой ролью.
   *
   * 'approval' закрыт для всех сознательно (обоснование из 0074): руководитель видит конкретный
   * состав и сумму, и менять их под ним нельзя. Присуждённый заказ правит только тот, кто
   * подтверждал поставщика. Терминальные стадии закрыты — там менять нечего.
   */
  function assertCompositionEditable(
    status: string,
    role: Role,
  ): { ok: true } | { ok: false; status: number; error: string } {
    if (status === 'forming' || status === 'sourcing') return { ok: true };
    if (status === 'awarded') {
      return PROCUREMENT_ASSIGN_ROLES.includes(role as never)
        ? { ok: true }
        : { ok: false, status: 403, error: 'Менять состав присуждённого заказа может админ или руководитель' };
    }
    if (status === 'approval') {
      return { ok: false, status: 409, error: 'Заказ на согласовании — состав менять нельзя' };
    }
    return { ok: false, status: 409, error: 'Заказ завершён — состав менять нельзя' };
  }

  /**
   * Финансовые последствия изменения состава: пересчёт суммы и требование нового счёта.
   *
   * Сумма считается общим recalcOrderAmount — той же формулой, что при оформлении победителя.
   * Пока цены не заданы (стадии до оформления), считать нечего и требовать новый счёт не за что.
   */
  async function applyCompositionChange(
    client: PoolClient,
    lot: { id: string; sourcing_status: string; vat_rate: string | null },
  ): Promise<{ ok: true; amount: string | null; needsNewInvoice: boolean } | { ok: false; status: number; error: string }> {
    const priced = lot.sourcing_status === 'awarded' && lot.vat_rate != null;
    if (!priced) {
      await client.query(
        'UPDATE supplier_orders SET row_version = row_version + 1, updated_at = now() WHERE id = $1',
        [lot.id],
      );
      return { ok: true, amount: null, needsNewInvoice: false };
    }

    const { amount, missingPrices } = await recalcOrderAmount(client, lot.id, lot.vat_rate as ManualVatRate);
    if (missingPrices.length) {
      // Цена есть не по всем материалам: молча занизить сумму нельзя, а угадать её — тем более.
      return { ok: false, status: 409, error: 'Цены заказа неполны — оформите заказ заново' };
    }
    // Сумма изменилась → действующий счёт больше ей не соответствует. Заказ при этом остаётся
    // присуждённым: повторное согласование не требуется, нужен лишь новый документ.
    await client.query(
      `UPDATE supplier_orders
          SET amount = $2, invoice_revision = invoice_revision + 1,
              row_version = row_version + 1, updated_at = now()
        WHERE id = $1`,
      [lot.id, amount],
    );
    return { ok: true, amount, needsNewInvoice: true };
  }

  /** Свернуть строки свода в области назначения (строк всегда больше, чем областей). */
  async function scopesOfItems(db: Pool | PoolClient, requestItemIds: string[]) {
    const { rows } = await db.query(
      `SELECT DISTINCT mr.project_id, mr.contractor_id, mri.cost_type_id, mri.agg_key
         FROM material_request_items mri
         JOIN material_requests mr ON mr.id = mri.request_id
        WHERE mri.id = ANY($1::uuid[]) AND mr.status <> 'cancelled'`,
      [requestItemIds],
    );
    return rows.map((r) => ({
      projectId: r.project_id as string | null,
      contractorId: r.contractor_id as string | null,
      costTypeId: r.cost_type_id as string | null,
      aggKey: r.agg_key as string,
    }));
  }

  /** Записать/снять ответственного по областям выбранных строк. */
  async function applyResponsibleByItems(
    requestItemIds: string[], userId: string | null, actorId: string,
  ): Promise<{ status: number; body: unknown }> {
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const scopes = await scopesOfItems(client, requestItemIds);
      if (scopes.length === 0) {
        await client.query('ROLLBACK');
        return { status: 404, body: { error: 'Позиции не найдены или заявки отменены' } };
      }
      if (userId && !(await assertAssignableUser(client, userId))) {
        await client.query('ROLLBACK');
        return { status: 400, body: { error: 'Пользователь не может быть ответственным' } };
      }

      const p = scopes.map((s) => s.projectId);
      const c = scopes.map((s) => s.contractorId);
      const t = scopes.map((s) => s.costTypeId);
      const k = scopes.map((s) => s.aggKey);

      if (userId) {
        await client.query(
          `INSERT INTO procurement_material_responsible
                 (project_id, contractor_id, cost_type_id, agg_key, user_id, assigned_by)
           SELECT p, c, t, k, $5, $6
             FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[]) AS s(p, c, t, k)
           ON CONFLICT ON CONSTRAINT ux_pmr_scope DO UPDATE
              SET user_id = EXCLUDED.user_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
          [p, c, t, k, userId, actorId],
        );
      } else {
        await client.query(
          `DELETE FROM procurement_material_responsible r
             USING unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[]) AS s(p, c, t, k)
            WHERE r.project_id    IS NOT DISTINCT FROM s.p
              AND r.contractor_id IS NOT DISTINCT FROM s.c
              AND r.cost_type_id  IS NOT DISTINCT FROM s.t
              AND r.agg_key = s.k`,
          [p, c, t, k],
        );
      }

      await recordAudit(client, {
        estimateId: null, entityType: 'procurement_responsibles', entityId: userId ?? actorId,
        action: 'material.responsible.set', userId: actorId,
        changes: { userId, scopes: scopes.length, items: requestItemIds.length },
      });
      await client.query('COMMIT');
      return { status: 200, body: { data: { scopes: scopes.length, items: requestItemIds.length } } };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }

  // PUT /materials/:requestItemId/responsibles — назначить/снять по области строки.
  // Тело сохраняет форму { userIds } ради совместимости клиента; берётся первый элемент, потому
  // что ответственный теперь один (пустой массив = снять).
  fastify.put<{ Params: { requestItemId: string } }>(
    '/materials/:requestItemId/responsibles',
    { preHandler: [canAssignResponsible] },
    async (request, reply) => {
      const { userIds } = setMaterialResponsiblesSchema.parse(request.body);
      const { requestItemId } = request.params;
      if (!UUID_RE.test(requestItemId)) return reply.status(400).send({ error: 'Некорректный идентификатор позиции' });
      if (userIds.length > 1) return reply.status(400).send({ error: 'У материала один ответственный — обновите страницу' });
      const r = await applyResponsibleByItems([requestItemId], userIds[0] ?? null, request.currentUser.id);
      return reply.status(r.status).send(r.body);
    },
  );

  // PATCH /materials/responsibles — массово по областям выделенных строк.
  fastify.patch('/materials/responsibles', { preHandler: [canAssignResponsible] }, async (request, reply) => {
    const { requestItemIds, userIds } = bulkSetMaterialResponsiblesSchema.parse(request.body);
    if (userIds.length > 1) return reply.status(400).send({ error: 'У материала один ответственный — обновите страницу' });
    const r = await applyResponsibleByItems(requestItemIds, userIds[0] ?? null, request.currentUser.id);
    return reply.status(r.status).send(r.body);
  });

  // Legacy (на один релиз, для незакрытых старых вкладок): одиночный/массовый «один ответственный».
  fastify.patch<{ Params: { requestItemId: string } }>(
    '/materials/:requestItemId/responsible',
    { preHandler: [canAssignResponsible] },
    async (request, reply) => {
      const { userId } = assignMaterialResponsibleSchema.parse(request.body);
      const { requestItemId } = request.params;
      if (!UUID_RE.test(requestItemId)) return reply.status(400).send({ error: 'Некорректный идентификатор позиции' });
      const r = await applyResponsibleByItems([requestItemId], userId, request.currentUser.id);
      return reply.status(r.status).send(r.body);
    },
  );
  fastify.patch('/materials/responsible', { preHandler: [canAssignResponsible] }, async (request, reply) => {
    const { requestItemIds, userId } = bulkAssignMaterialResponsibleSchema.parse(request.body);
    const r = await applyResponsibleByItems([...new Set(requestItemIds)], userId, request.currentUser.id);
    return reply.status(r.status).send(r.body);
  });

  // ============================================================
  // POST / — сформировать новый лот или добавить позиции в существующий (forming)
  // ============================================================
  fastify.post('/', async (request, reply) => {
    const user = request.currentUser;
    const body = formLotSchema.parse(request.body);
    const itemIds = body.items.map((i) => i.requestItemId);

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

      // Доступ к УЖЕ СУЩЕСТВУЮЩЕМУ заказу. Проверка ниже (по областям добавляемых материалов)
      // его не покрывает: обе ветки выше — и явный orderId, и повтор по clientRequestId —
      // возвращают чужой заказ, в который позиции дописываются UPSERT'ом. Без этой проверки
      // инженер дописывал бы материалы своей зоны в заказ, который вести не вправе.
      // Для только что созданного заказа правило пустого заказа пропускает создателя.
      const orderAccess = await assertOrderAccessForOrder(client, user, orderId);
      if (!orderAccess.ok) {
        await client.query('ROLLBACK');
        return reply.status(403).send({ error: orderAccess.reason });
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

      // Разграничение по зонам ответственности (справочник «Закупки»): вести заказ по области
      // (объект+подрядчик+вид затрат+материал) может её ответственный, его заместитель или админ.
      // Fallback — область без назначений на всех трёх уровнях доступна всем внутренним ролям.
      const access = await assertOrderAccess(
        client,
        user.id,
        user.role,
        body.items.map((it) => {
          const r = srcMap.get(it.requestItemId)!;
          return {
            projectId: r.project_id ?? null,
            contractorId: r.contractor_id ?? null,
            costTypeId: r.cost_type_id ?? null,
            aggKey: r.agg_key as string,
          };
        }),
      );
      if (!access.ok) {
        await client.query('ROLLBACK');
        return reply.status(403).send({ error: access.reason });
      }

      // --- Проверка остатка (инвариант И1): want > requested − размещённое в ДРУГИХ активных лотах ---
      const viol = await assertRemainingFits(
        client,
        body.items.map((it) => ({ requestItemId: it.requestItemId, quantity: it.quantity })),
        orderId,
      );
      if (viol.length) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          error: 'Превышен доступный остаток по материалам',
          items: viol.map((v) => ({
            requestItemId: v.requestItemId,
            name: v.name,
            remaining: v.remaining,
            requested: v.requested,
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
        const sched = await replaceSchedule(client, orderId, body.deliverySchedule);
        if (!sched.ok) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: sched.error });
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
    const body = deleteOrderItemSchema.parse(request.body ?? {});
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, created_by, row_version, vat_rate
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      const access = await assertOrderAccessForOrder(client, user, lot.id);
      if (!access.ok) { await client.query('ROLLBACK'); return reply.status(403).send({ error: access.reason }); }

      const gate = assertCompositionEditable(lot.sourcing_status, user.role);
      if (!gate.ok) { await client.query('ROLLBACK'); return reply.status(gate.status).send({ error: gate.error }); }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: lot.row_version });
      }

      // Пустой заказ существовать не должен: у присуждённого он нарушил бы смысл суммы, у
      // формируемого — превратился бы в мусор. Убрать всё целиком — это отмена заказа.
      const { rows: cnt } = await client.query(
        'SELECT count(*)::int AS n FROM supplier_order_items WHERE order_id = $1', [lot.id],
      );
      if (cnt[0].n <= 1) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'В заказе не останется материалов — отмените заказ целиком' });
      }

      const { rows: delRows } = await client.query(
        `DELETE FROM supplier_order_items WHERE id = $1 AND order_id = $2
         RETURNING request_id, agg_key, material_name, quantity::numeric AS quantity`,
        [request.params.itemId, lot.id],
      );
      if (!delRows[0]) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Позиция не найдена' }); }
      const removed = delRows[0];

      // Если это была последняя строка своего материала, его цена и график осиротели: оставленная
      // ценовая строка сломала бы сверку множеств agg_key при следующем оформлении.
      const { rows: leftRows } = await client.query(
        `SELECT COALESCE(SUM(quantity), 0)::numeric AS qty, count(*)::int AS n
           FROM supplier_order_items WHERE order_id = $1 AND agg_key = $2`,
        [lot.id, removed.agg_key],
      );
      if (leftRows[0].n === 0) {
        await client.query('DELETE FROM supplier_order_price_lines WHERE order_id = $1 AND agg_key = $2', [lot.id, removed.agg_key]);
        await dropScheduleForAgg(client, lot.id, removed.agg_key);
      } else {
        await reconcileScheduleAfterQtyChange(client, lot.id, removed.agg_key, Number(leftRows[0].qty));
      }

      const finance = await applyCompositionChange(client, lot);
      if (!finance.ok) { await client.query('ROLLBACK'); return reply.status(finance.status).send({ error: finance.error }); }

      const auditId = await appendOrderAudit(client, {
        orderId: lot.id, action: 'item_removed', userId: user.id,
        changes: {
          materialName: removed.material_name, quantity: Number(removed.quantity),
          reason: body.reason ?? null, stage: lot.sourcing_status,
        },
        projectId: lot.project_id,
      });
      await client.query(
        `INSERT INTO supplier_order_item_edits
           (audit_id, order_id, order_item_id, material_name, agg_key, quantity_from, quantity_to, action, changed_by)
         VALUES ($1,$2,NULL,$3,$4,$5,0,'removed',$6)`,
        [auditId, lot.id, removed.material_name, removed.agg_key, removed.quantity, user.id],
      );

      if (removed.request_id) await recalcRequestStatus(client, removed.request_id, user.id);
      await client.query('COMMIT');
      return { data: { ok: true, amount: finance.amount, needsNewInvoice: finance.needsNewInvoice } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // PATCH /:id/items/:itemId — изменить количество позиции заказа.
  //   Увеличение сверх доступного остатка заявок отклоняется жёстко (инвариант И1). Уменьшение
  //   безопасно: резерв вычисляемый, поэтому освободившийся объём сразу возвращается в свод.
  // ============================================================
  fastify.patch<{ Params: { id: string; itemId: string } }>('/:id/items/:itemId', async (request, reply) => {
    const user = request.currentUser;
    const body = patchOrderItemSchema.parse(request.body);
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, row_version, vat_rate
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      const access = await assertOrderAccessForOrder(client, user, lot.id);
      if (!access.ok) { await client.query('ROLLBACK'); return reply.status(403).send({ error: access.reason }); }

      const gate = assertCompositionEditable(lot.sourcing_status, user.role);
      if (!gate.ok) { await client.query('ROLLBACK'); return reply.status(gate.status).send({ error: gate.error }); }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: lot.row_version });
      }

      const { rows: itemRows } = await client.query(
        `SELECT id, request_id, request_item_id, agg_key, material_name, quantity::numeric AS quantity
           FROM supplier_order_items WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [request.params.itemId, lot.id],
      );
      const item = itemRows[0];
      if (!item) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Позиция не найдена' }); }
      if (Math.abs(Number(item.quantity) - body.quantity) < 1e-9) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Количество не изменилось' });
      }

      // Инвариант И1. Исключаем и сам заказ, и правимую строку: без второго её текущее количество
      // учлось бы дважды, и любое увеличение отклонялось бы как перезаказ.
      // При осиротевшей позиции (заявку дорабатывали, request_item_id = NULL) сверять не с чем.
      if (item.request_item_id) {
        const viol = await assertRemainingFits(
          client,
          [{ requestItemId: item.request_item_id, quantity: body.quantity }],
          lot.id,
          item.id,
        );
        if (viol.length) {
          await client.query('ROLLBACK');
          return reply.status(409).send({
            error: 'Превышен доступный остаток по материалу',
            items: viol.map((v) => ({ requestItemId: v.requestItemId, name: v.name, remaining: v.remaining, requested: v.requested })),
          });
        }
      }

      await client.query('UPDATE supplier_order_items SET quantity = $2 WHERE id = $1', [item.id, body.quantity]);

      // График: либо прислан клиентом целиком, либо подгоняется автоматически.
      const { rows: aggRows } = await client.query(
        `SELECT COALESCE(SUM(quantity), 0)::numeric AS qty FROM supplier_order_items WHERE order_id = $1 AND agg_key = $2`,
        [lot.id, item.agg_key],
      );
      const newAggQty = Number(aggRows[0].qty);
      if (body.schedule) {
        const sched = await replaceSchedule(client, lot.id, [{ aggKey: item.agg_key, entries: body.schedule }]);
        if (!sched.ok) { await client.query('ROLLBACK'); return reply.status(400).send({ error: sched.error }); }
      } else {
        await reconcileScheduleAfterQtyChange(client, lot.id, item.agg_key, newAggQty);
      }

      const finance = await applyCompositionChange(client, lot);
      if (!finance.ok) { await client.query('ROLLBACK'); return reply.status(finance.status).send({ error: finance.error }); }

      const auditId = await appendOrderAudit(client, {
        orderId: lot.id, action: 'item_quantity_changed', userId: user.id,
        changes: {
          materialName: item.material_name, from: Number(item.quantity), to: body.quantity,
          reason: body.reason ?? null, stage: lot.sourcing_status,
        },
        projectId: lot.project_id,
      });
      await client.query(
        `INSERT INTO supplier_order_item_edits
           (audit_id, order_id, order_item_id, material_name, agg_key, quantity_from, quantity_to, action, changed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'quantity_changed',$8)`,
        [auditId, lot.id, item.id, item.material_name, item.agg_key, item.quantity, body.quantity, user.id],
      );

      if (item.request_id) await recalcRequestStatus(client, item.request_id, user.id);
      await client.query('COMMIT');
      return { data: { ok: true, amount: finance.amount, needsNewInvoice: finance.needsNewInvoice } };
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
      const access = await assertOrderAccessForOrder(client, user, lot.id);
      if (!access.ok) { await client.query('ROLLBACK'); return reply.status(403).send({ error: access.reason }); }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ зафиксирован — график менять нельзя' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: lot.row_version });
      }

      const sched = await replaceSchedule(client, lot.id, body.schedule);
      if (!sched.ok) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: sched.error });
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
      const access = await assertOrderAccessForOrder(client, user, lot.id);
      if (!access.ok) { await client.query('ROLLBACK'); return reply.status(403).send({ error: access.reason }); }
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
    // Прежний клиент шлёт запрос без тела — схема целиком необязательна.
    const body = cancelOrderSchema.parse(request.body ?? {});
    const client = await fastify.pool.connect();
    let kick = false;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, procurement_method, tender_portal_id, tender_external_ref,
                row_version, supplier_name, amount
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      const access = await assertOrderAccessForOrder(client, user, lot.id);
      if (!access.ok) { await client.query('ROLLBACK'); return reply.status(403).send({ error: access.reason }); }
      if (['cancelled', 'cancel_pending', 'no_award'].includes(lot.sourcing_status)) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ уже нельзя отменить' });
      }
      // Отмена ПРИСУЖДЁННОГО заказа — отдельное решение: поставщик уже подтверждён руководителем,
      // поэтому её принимает тот, кто подтверждает, и обязательно с причиной.
      const wasAwarded = lot.sourcing_status === 'awarded';
      if (wasAwarded) {
        if (!PROCUREMENT_ASSIGN_ROLES.includes(user.role as never)) {
          await client.query('ROLLBACK');
          return reply.status(403).send({ error: 'Отменить присуждённый заказ может админ или руководитель' });
        }
        if (!body.reason) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Укажите причину отмены' });
        }
      }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: lot.row_version });
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
      // ПРИСУЖДЁННЫЙ тендер сюда не попадает: он уже finished, отменять на площадке нечего, а
      // посланная команда отмены висела бы в ретраях до исчерпания попыток.
      const holdForTender = isTender && !wasAwarded && (Boolean(lot.tender_portal_id) || createPending);
      const next = holdForTender ? 'cancel_pending' : 'cancelled';
      const notifyPortal = holdForTender && Boolean(lot.tender_portal_id);

      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = $2,
                desired_tender_state = CASE WHEN $3::boolean THEN 'cancelled' ELSE desired_tender_state END,
                tender_next_poll_at = CASE WHEN $4::boolean THEN now() ELSE tender_next_poll_at END,
                cancelled_at = now(), cancelled_by = $5, cancel_reason = $6,
                row_version = row_version + 1, updated_at = now()
          WHERE id = $1`,
        [lot.id, next, holdForTender, notifyPortal, user.id, body.reason ?? null],
      );
      // Действующие счета теряют силу вместе с заказом.
      await client.query(
        `UPDATE supplier_order_invoices SET superseded_at = now(), superseded_reason = 'replaced'
          WHERE order_id = $1 AND superseded_at IS NULL`,
        [lot.id],
      );
      // Тендер уже на портале — ставим надёжную команду отмены (идемпотентно по partial-unique).
      if (notifyPortal) {
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
      } else if (holdForTender && createPending) {
        kick = true; // разбудить create-worker, чтобы он перечитал намерение и прервал создание
      }
      await appendOrderAudit(client, {
        orderId: lot.id, action: 'cancelled', userId: user.id,
        changes: {
          next,
          from: lot.sourcing_status,
          reason: body.reason ?? null,
          // У присуждённого заказа фиксируем, что именно отменяется: реестр и история должны
          // показывать, кто и на какую сумму был выбран.
          ...(wasAwarded ? { supplierName: lot.supplier_name, amount: lot.amount } : {}),
        },
        projectId: lot.project_id,
      });
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
  // POST /:id/revoke-award — отозвать присуждение (смена поставщика): awarded → sourcing.
  //
  //   Заказ остаётся живым, меняется только поставщик, поэтому материалы НЕ возвращаются в свод:
  //   'sourcing' входит в FROZEN_LOT_STATUSES, состав по-прежнему занят этим заказом.
  //
  //   Поставщик, сумма и признаки присуждения СБРАСЫВАЮТСЯ — в отличие от reject-approval, где они
  //   сохраняются намеренно. Разница в намерении: там инженер правит СВОЁ предложение, здесь
  //   поставщика меняют, и оставленное имя показывалось бы в реестре как действующий выбор.
  //   Предложения и цены остаются: из них выбирается новый победитель.
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/revoke-award', { preHandler: [canManageAwarded] }, async (request, reply) => {
    const user = request.currentUser;
    const body = revokeAwardSchema.parse(request.body);
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, procurement_method, row_version,
                supplier_name, amount, proposed_offer_id, invoice_revision
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const order = rows[0];
      if (!order) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (order.sourcing_status !== 'awarded') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Сменить поставщика можно только у присуждённого заказа' });
      }
      // Тендер отсекаем сознательно: у лота остались бы portal_id и результаты завершённого
      // тендера, а сам он вернулся бы в ручной сбор — состояние, которого не понимает ни один
      // существующий обработчик.
      if (order.procurement_method === 'tender') {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          error: 'Заказ закупался через тендер — отмените его и проведите новую закупку',
        });
      }
      if (body.expectedVersion != null && body.expectedVersion !== order.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: order.row_version });
      }

      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = 'sourcing',
                awarded_at = NULL, awarded_by = NULL, awarded_quote_id = NULL, award_source = NULL,
                approved_at = NULL, approved_by = NULL,
                approval_requested_at = NULL, approval_requested_by = NULL, approval_comment = NULL,
                supplier_id = NULL, supplier_name = NULL, supplier_inn = NULL, amount = NULL,
                proposed_offer_id = NULL, vat_rate = NULL, payment_type = NULL,
                invoice_revision = invoice_revision + 1,
                row_version = row_version + 1, updated_at = now()
          WHERE id = $1`,
        [order.id],
      );
      // Счёт прежнего поставщика больше не действует.
      await client.query(
        `UPDATE supplier_order_invoices SET superseded_at = now(), superseded_reason = 'award_revoked'
          WHERE order_id = $1 AND superseded_at IS NULL`,
        [order.id],
      );
      await appendOrderAudit(client, {
        orderId: order.id, action: 'award_revoked', userId: user.id,
        changes: {
          reason: body.reason,
          previousSupplier: order.supplier_name,
          previousAmount: order.amount,
          previousOfferId: order.proposed_offer_id,
        },
        projectId: order.project_id,
      });
      // Покрытие заявок изменилось: заказ больше не присуждён, и su10-заявка должна вернуться из
      // «Выбран поставщик» в «В работе». Без этого пересчёта она зависла бы навсегда.
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [order.id]);
      for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, user.id);
      await client.query('COMMIT');
      return { data: { id: order.id, sourcingStatus: 'sourcing' } };
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
      const access = await assertOrderAccessForOrder(client, user, lot.id);
      if (!access.ok) { await client.query('ROLLBACK'); return reply.status(403).send({ error: access.reason }); }
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
      const access = await assertOrderAccessForOrder(client, user, lot.id);
      if (!access.ok) { await client.query('ROLLBACK'); return reply.status(403).send({ error: access.reason }); }
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
    // Обновление тендера — мутация, а не чтение: refreshTenderLot пишет статус, результаты и может
    // перевести заказ в отменённый, пересчитав статусы заявок.
    const access = await assertOrderAccessForOrder(fastify.pool, request.currentUser, request.params.id);
    if (!access.ok) return reply.status(403).send({ error: access.reason });
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

  // Стадии, на которых заказ открыт для работы с поставщиками: набор предложений идёт и по ещё
  // формируемому заказу. Держим одним списком — маршрут загрузки файла проверяет его отдельно
  // (транзакцию через потоковую загрузку не протянуть), и расходиться эти проверки не должны.
  const OFFERABLE_STATUSES = ['forming', 'sourcing'];

  // Заказ доступен для работы с поставщиками: стадия сбора предложений (sourcing), не тендер.
  //
  // Читаем через переданный db, а не через пул: у маршрутов ниже проверка стадии, проверка зоны и
  // сама запись обязаны идти по ОДНОМУ соединению внутри транзакции. Иначе между «прочитали статус
  // sourcing» и «вставили предложение» заказ успевал уйти на согласование, и предложение
  // добавлялось в замороженный заказ.
  async function loadOfferableOrder(db: Pool | PoolClient, id: string, lock = false) {
    const { rows } = await db.query(
      `SELECT id, sourcing_status, procurement_method, project_id FROM supplier_orders
        WHERE id = $1 AND kind = 'sourcing'${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows[0] as { id: string; sourcing_status: string; procurement_method: string | null; project_id: string | null } | undefined;
  }

  /**
   * Общая обвязка маршрутов предложений: транзакция, блокировка заказа, стадия, зона.
   * Тело получает уже проверенный заказ и тот же клиент; ошибки внутри откатывают всё.
   */
  async function withOfferableOrder(
    orderId: string,
    user: { id: string; role: Role },
    verb: string,
    reply: { status(c: number): { send(b: unknown): unknown } },
    body: (client: PoolClient, order: { id: string; project_id: string | null }) => Promise<unknown>,
  ): Promise<unknown> {
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await loadOfferableOrder(client, orderId, true);
      if (!order) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (!OFFERABLE_STATUSES.includes(order.sourcing_status) || order.procurement_method === 'tender') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: `${verb} можно только по формируемому заказу или заказу в стадии сбора предложений` });
      }
      const access = await assertOrderAccessForOrder(client, user, order.id);
      if (!access.ok) { await client.query('ROLLBACK'); return reply.status(403).send({ error: access.reason }); }
      const result = await body(client, order);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // POST /:id/offers — добавить поставщика-предложение (manual, стадия сбора; сумма необязательна)
  //   Свободная форма: название и привязка к справочнику необязательны, достаточно комментария.
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/offers', async (request, reply) => {
    const user = request.currentUser;
    const body = upsertOfferSchema.parse(request.body);
    return withOfferableOrder(request.params.id, user, 'Добавлять поставщиков', reply, async (client, order) => {
      const { rows: ins } = await client.query(
        `INSERT INTO supplier_order_offers
           (order_id, supplier_id, supplier_name, supplier_inn, amount, currency, response_status, terms, note, created_by)
         VALUES ($1,$2,$3,$4,$5,'RUB',$6,$7,$8,$9) RETURNING id`,
        [order.id, body.supplierId ?? null, body.supplierName ?? null, body.supplierInn ?? null, body.amount ?? null,
         body.responseStatus ?? 'pending', body.terms ?? null, body.note ?? null, user.id],
      );
      // Безымянную строку в журнале опознают по комментарию — иначе запись «добавлен поставщик»
      // была бы про никого.
      await appendOrderAudit(client, { orderId: order.id, action: 'offer_added', userId: user.id, changes: { supplierName: body.supplierName ?? body.note }, projectId: order.project_id });
      return reply.status(201).send({ data: { id: ins[0].id } });
    });
  });

  // PATCH /:id/offers/:offerId — правка поставщика (имя/ИНН/сумма/статус ответа), пока не оформлен.
  fastify.patch<{ Params: { id: string; offerId: string } }>('/:id/offers/:offerId', async (request, reply) => {
    const body = upsertOfferSchema.parse(request.body);
    return withOfferableOrder(request.params.id, request.currentUser, 'Менять поставщиков', reply, async (client, order) => {
      const { rowCount } = await client.query(
        `UPDATE supplier_order_offers
            SET supplier_id = $3, supplier_name = $4, supplier_inn = $5, amount = $6,
                response_status = COALESCE($7, response_status), terms = $8, note = $9
          WHERE id = $1 AND order_id = $2`,
        [request.params.offerId, order.id, body.supplierId ?? null, body.supplierName ?? null, body.supplierInn ?? null,
         body.amount ?? null, body.responseStatus ?? null, body.terms ?? null, body.note ?? null],
      );
      if (!rowCount) return reply.status(404).send({ error: 'Предложение не найдено' });
      return { data: { ok: true } };
    });
  });

  // DELETE /:id/offers/:offerId — убрать поставщика (пока заказ не оформлен); S3-объект чистим.
  fastify.delete<{ Params: { id: string; offerId: string } }>('/:id/offers/:offerId', async (request, reply) => {
    // Ключ собираем в объект, а не в let: присваивание из колбэка сужение типов не отменяет,
    // и проверка «if (orphanKey)» после вызова читалась бы компилятором как заведомо ложная.
    const orphan: { key: string | null } = { key: null };
    const result = await withOfferableOrder(request.params.id, request.currentUser, 'Убирать поставщиков', reply, async (client, order) => {
      const { rows: del } = await client.query(
        `DELETE FROM supplier_order_offers WHERE id = $1 AND order_id = $2 RETURNING file_key`,
        [request.params.offerId, order.id],
      );
      if (!del[0]) return reply.status(404).send({ error: 'Предложение не найдено' });
      orphan.key = del[0].file_key ?? null;
      return { data: { ok: true } };
    });
    // Объект в S3 удаляем ПОСЛЕ коммита: откат транзакции не вернул бы уже удалённый файл.
    if (orphan.key && fastify.storage) await fastify.storage.deleteObject(orphan.key).catch(() => {});
    return result;
  });

  // ============================================================
  // POST /:id/offers/:offerId/file — приложить документ поставщика (КП/счёт), потоковый multipart.
  //   Загрузка автоматически ставит статус ответа 'received'. Замена: новый объект → БД → удалить старый.
  // ============================================================
  fastify.post<{ Params: { id: string; offerId: string }; Querystring: { documentType?: string } }>(
    '/:id/offers/:offerId/file',
    async (request, reply) => {
      const user = request.currentUser;
      // Транзакцию через потоковую загрузку не тянем — соединение висело бы всё время передачи
      // файла. Поэтому проверка идёт ДВАЖДЫ: здесь, чтобы не принимать заведомо лишние 50 МБ,
      // и ещё раз перед записью в БД (ниже) — за время загрузки заказ мог уйти на согласование
      // или сменить ответственного.
      const order = await loadOfferableOrder(fastify.pool, request.params.id);
      if (!order) return reply.status(404).send({ error: 'Заказ не найден' });
      // Стадии те же, что у самих предложений: КП нередко приходит раньше, чем состав заказа
      // окончательно собран, и заставлять держать файл «в столе» до фиксации незачем.
      if (!OFFERABLE_STATUSES.includes(order.sourcing_status) || order.procurement_method === 'tender') {
        return reply.status(409).send({ error: 'Документы поставщиков — только по формируемому заказу или заказу в стадии сбора предложений' });
      }
      const preAccess = await assertOrderAccessForOrder(fastify.pool, user, order.id);
      if (!preAccess.ok) return reply.status(403).send({ error: preAccess.reason });
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
        // Повторная проверка вместе с записью, на одном соединении в транзакции.
        const client = await fastify.pool.connect();
        try {
          await client.query('BEGIN');
          const fresh = await loadOfferableOrder(client, order.id, true);
          if (!fresh || !OFFERABLE_STATUSES.includes(fresh.sourcing_status) || fresh.procurement_method === 'tender') {
            await client.query('ROLLBACK');
            await fastify.storage.deleteObject(meta.key).catch(() => {});
            return reply.status(409).send({ error: 'Заказ изменился, пока загружался файл — документ не сохранён' });
          }
          const access = await assertOrderAccessForOrder(client, user, order.id);
          if (!access.ok) {
            await client.query('ROLLBACK');
            await fastify.storage.deleteObject(meta.key).catch(() => {});
            return reply.status(403).send({ error: access.reason });
          }
          await client.query(
            `UPDATE supplier_order_offers
                SET file_key = $3, file_name = $4, mime_type = $5, checksum = $6, file_size = $7,
                    document_type = $8, response_status = 'received'
              WHERE id = $1 AND order_id = $2`,
            [request.params.offerId, order.id, meta.key, meta.safeName, meta.mime, meta.checksum, meta.size, documentType],
          );
          await client.query('COMMIT');
        } catch (dbErr) {
          await client.query('ROLLBACK').catch(() => {});
          await fastify.storage.deleteObject(meta.key).catch(() => {});
          throw dbErr;
        } finally {
          client.release();
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
    // Зона ответственности проверяется и на скачивании: без неё документ поставщика по чужой
    // закупке был доступен любой внутренней роли — общей аутентификации для коммерческой тайны мало.
    const access = await assertOrderAccessForOrder(fastify.pool, request.currentUser, request.params.id);
    if (!access.ok) return reply.status(403).send({ error: access.reason });

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
        // Ручное присуждение закрыто: оно присуждало поставщика напрямую, минуя согласование
        // руководителем. Путь один — submit-approval → approve.
        await client.query('ROLLBACK');
        return reply.status(409).send({
          error: 'Поставщика по КП подтверждает руководитель — отправьте заказ на согласование',
        });
      }
      {
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
  // Согласование поставщика руководителем (manual-канал)
  // ============================================================
  //
  // Инженер выбирает победителя и вводит цены → submit-approval переводит заказ в 'approval'
  // (состав и резерв заморожены) → руководитель подтверждает (approve → 'awarded') или отклоняет
  // (reject-approval → 'sourcing' с сохранением предложения).
  //
  // Оба прежних пути присуждения закрыты: публичный /finalize отвечает 409, а manual-ветка
  // /award — тоже 409. Иначе согласование обходилось бы одним HTTP-запросом.

  const canApprove = requireRole(...PROCUREMENT_ASSIGN_ROLES);

  /**
   * Общая часть оформления: проверка победителя, сверка множества agg_key, запись цен и расчёт
   * итоговой суммы в SQL numeric. Возвращает данные победителя и сумму либо готовый ответ с ошибкой.
   */
  async function applyWinnerProposal(
    client: PoolClient,
    order: { id: string; project_id: string | null },
    body: {
      winnerOfferId: string; winnerSupplierId: string; vatRate: string; paymentType: string;
      lines: { aggKey: string; unitPrice: string; warrantyMonths?: number | null }[];
    },
  ): Promise<
    | { ok: true; winner: Record<string, unknown>; amount: string }
    | { ok: false; status: number; error: string }
  > {
    const aggKeys = body.lines.map((l) => l.aggKey);
    if (new Set(aggKeys).size !== aggKeys.length) {
      return { ok: false, status: 400, error: 'Дублирующиеся материалы в ценах' };
    }

    // Победитель: принадлежит заказу, ответ получен, документ приложен.
    const { rows: wRows } = await client.query(
      `SELECT id, supplier_id, supplier_name, supplier_inn, response_status, file_key
         FROM supplier_order_offers WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [body.winnerOfferId, order.id],
    );
    const winner = wRows[0];
    if (!winner) return { ok: false, status: 404, error: 'Победитель не найден' };
    if (winner.response_status !== 'received' || !winner.file_key) {
      return { ok: false, status: 409, error: 'Победителем можно выбрать только поставщика с полученным предложением и приложенным документом' };
    }

    // Реквизиты победителя берём из справочника, а не из введённого вручную текста: предложения
    // набираются свободной формой, а на согласование должен уйти опознаваемый контрагент — по нему
    // дальше идут счета и оплаты. Заодно строка предложения дополняется этой привязкой.
    const { rows: sRows } = await client.query(
      `SELECT id, name, inn FROM organizations WHERE id = $1 AND type = 'supplier' AND is_active`,
      [body.winnerSupplierId],
    );
    const supplier = sRows[0];
    if (!supplier) return { ok: false, status: 409, error: 'Поставщик-победитель должен быть выбран из справочника' };
    await client.query(
      `UPDATE supplier_order_offers SET supplier_id = $2, supplier_name = $3, supplier_inn = $4 WHERE id = $1`,
      [winner.id, supplier.id, supplier.name, supplier.inn ?? null],
    );
    winner.supplier_id = supplier.id;
    winner.supplier_name = supplier.name;
    winner.supplier_inn = supplier.inn ?? null;

    // Цены должны покрывать ВСЕ агрегаты заказа (точное совпадение множеств agg_key).
    const { rows: orderKeys } = await client.query(
      `SELECT DISTINCT agg_key FROM supplier_order_items WHERE order_id = $1`,
      [order.id],
    );
    const orderSet = new Set(orderKeys.map((r) => r.agg_key as string));
    if (orderSet.size !== aggKeys.length || aggKeys.some((k) => !orderSet.has(k))) {
      return { ok: false, status: 400, error: 'Заполните цены по всем материалам заказа' };
    }

    await client.query('DELETE FROM supplier_order_price_lines WHERE order_id = $1', [order.id]);
    await client.query(
      `INSERT INTO supplier_order_price_lines (order_id, agg_key, unit_price, warranty_months)
       SELECT $1, k, p, w FROM unnest($2::text[], $3::numeric[], $4::int[]) AS t(k, p, w)`,
      [order.id, aggKeys, body.lines.map((l) => l.unitPrice), body.lines.map((l) => l.warrantyMonths ?? null)],
    );

    // ИТОГО считает общий recalcOrderAmount: та же формула применяется при правке состава
    // присуждённого заказа, и держать её в двух местах нельзя (см. lib/supplier-orders/pricing.ts).
    const { amount } = await recalcOrderAmount(client, order.id, body.vatRate as ManualVatRate);
    if (Number(amount) <= 0) {
      return { ok: false, status: 400, error: 'Итоговая сумма заказа должна быть больше нуля' };
    }
    return { ok: true, winner, amount };
  }

  // POST /:id/submit-approval — отправить выбранного поставщика на согласование.
  fastify.post<{ Params: { id: string } }>('/:id/submit-approval', async (request, reply) => {
    const user = request.currentUser;
    const body = finalizeOrderSchema.parse(request.body);

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
        return reply.status(409).send({ error: 'Отправить на согласование можно только заказ в стадии сбора предложений' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== order.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: order.row_version });
      }

      const access = await assertOrderAccessForOrder(client, user, order.id);
      if (!access.ok) { await client.query('ROLLBACK'); return reply.status(403).send({ error: access.reason }); }

      const applied = await applyWinnerProposal(client, order, body);
      if (!applied.ok) { await client.query('ROLLBACK'); return reply.status(applied.status).send({ error: applied.error }); }
      const { winner, amount } = applied;

      // Предложение фиксируем в proposed_offer_id; awarded_* останутся пустыми до подтверждения,
      // поэтому supplier_orders_awarded_fields_check продолжает работать как страховка.
      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = 'approval', vat_rate = $2, payment_type = $3,
                supplier_id = $4, supplier_name = $5, supplier_inn = $6, amount = $7,
                proposed_offer_id = $8, approval_requested_at = now(), approval_requested_by = $9,
                approval_comment = NULL, approved_at = NULL, approved_by = NULL,
                row_version = row_version + 1, updated_at = now()
          WHERE id = $1`,
        [order.id, body.vatRate, body.paymentType, winner.supplier_id, winner.supplier_name,
         winner.supplier_inn, amount, winner.id, user.id],
      );
      await appendOrderAudit(client, {
        orderId: order.id, action: 'approval_requested', userId: user.id,
        changes: { vatRate: body.vatRate, paymentType: body.paymentType, amount, supplierName: winner.supplier_name },
        projectId: order.project_id,
      });
      // recalcRequestStatus не вызываем: покрытие заявок не изменилось — заказ ещё не присуждён.
      await client.query('COMMIT');
      return { data: { id: order.id, sourcingStatus: 'approval', amount, supplierName: winner.supplier_name } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // POST /:id/approve — подтвердить поставщика (руководитель).
  fastify.post<{ Params: { id: string } }>('/:id/approve', { preHandler: [canApprove] }, async (request, reply) => {
    const user = request.currentUser;
    const body = approveOrderSchema.parse(request.body);

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, row_version, proposed_offer_id, approval_requested_by
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const order = rows[0];
      if (!order) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (order.sourcing_status !== 'approval') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Подтвердить можно только заказ на согласовании' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== order.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: order.row_version });
      }

      // awarded_by — кто присудил: акт присуждения и есть подтверждение, поэтому это согласующий.
      // Автор предложения сохранён отдельно в approval_requested_by.
      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = 'awarded', award_source = 'manual',
                awarded_quote_id = proposed_offer_id, awarded_at = now(), awarded_by = $2,
                approved_at = now(), approved_by = $2, approval_comment = $3,
                row_version = row_version + 1, updated_at = now()
          WHERE id = $1`,
        [order.id, user.id, body.comment ?? null],
      );
      await appendOrderAudit(client, {
        orderId: order.id, action: 'approved', userId: user.id,
        changes: { comment: body.comment ?? null, requestedBy: order.approval_requested_by },
        projectId: order.project_id,
      });
      // Заказ присуждён — покрытие заявок изменилось (su10 переходят в «Выбран поставщик»).
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [order.id]);
      for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, user.id);
      await client.query('COMMIT');
      return { data: { id: order.id, sourcingStatus: 'awarded' } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // POST /:id/reject-approval — отклонить с комментарием (руководитель).
  fastify.post<{ Params: { id: string } }>('/:id/reject-approval', { preHandler: [canApprove] }, async (request, reply) => {
    const user = request.currentUser;
    const body = rejectApprovalSchema.parse(request.body);

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, row_version FROM supplier_orders
          WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const order = rows[0];
      if (!order) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Заказ не найден' }); }
      if (order.sourcing_status !== 'approval') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Отклонить можно только заказ на согласовании' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== order.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заказ изменён, обновите страницу', rowVersion: order.row_version });
      }

      // Возврат в сбор предложений. Поставщик, сумма, цены и proposed_offer_id СОХРАНЯЮТСЯ:
      // инженер правит своё предложение, а не набирает его заново.
      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = 'sourcing', approval_comment = $2,
                approved_at = NULL, approved_by = NULL,
                row_version = row_version + 1, updated_at = now()
          WHERE id = $1`,
        [order.id, body.comment],
      );
      await appendOrderAudit(client, {
        orderId: order.id, action: 'approval_rejected', userId: user.id,
        changes: { comment: body.comment }, projectId: order.project_id,
      });
      await client.query('COMMIT');
      return { data: { id: order.id, sourcingStatus: 'sourcing' } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // POST /:id/finalize — DEPRECATED. Прямое присуждение в обход согласования закрыто.
  // Отвечаем 409, а не 404: у пользователя со старой вкладкой должно быть понятное объяснение.
  fastify.post<{ Params: { id: string } }>('/:id/finalize', async (_request, reply) =>
    reply.status(409).send({ error: 'Поставщика теперь подтверждает руководитель — обновите страницу' }));


  // ============================================================
  // GET /registry — единый реестр закупок (4 вида: заказ поставщику / тендер / заказ по РП / заказ
  //   поставщиком). Один скан supplier_orders (kind='sourcing' + kind='direct' JOIN заявок). Read-only.
  // ============================================================
  fastify.get<{ Querystring: { projectId?: string; type?: string; limit?: string; offset?: string; all?: string; awaitingApproval?: string } }>('/registry', async (request) => {
    const q = request.query;
    const projectId = q.projectId || null;
    // Очередь согласования фильтруем на СЕРВЕРЕ: клиентский фильтр по загруженной странице
    // не показал бы заказы за её пределами, а руководителю нужны все.
    const awaitingApproval = q.awaitingApproval === '1';
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
          AND ($5::boolean IS NOT TRUE OR (reg.link_kind = 'order' AND reg.status = 'approval'))
        ORDER BY reg.created_at DESC
        LIMIT $3 OFFSET $4`,
      [projectId, types, limit, offset, awaitingApproval],
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
  // ============================================================
  // PATCH /:id/comment — заметка снабжения о заказе.
  //   Отдельный роут, а не часть общей правки: комментарий не входит в закупочный контракт, поэтому
  //   НЕ бампает row_version — иначе правка заметки роняла бы expectedVersion в чужой открытой форме
  //   цен или графика. По той же причине здесь нет expectedVersion: конфликтовать не с чем.
  // ============================================================
  fastify.patch<{ Params: { id: string } }>('/:id/comment', async (request, reply) => {
    const user = request.currentUser;
    const body = patchOrderCommentSchema.parse(request.body);
    const next = body.comment?.trim() ? body.comment.trim() : null;

    const { rows } = await fastify.pool.query(
      `SELECT id, project_id, sourcing_status, comment FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
      [request.params.id],
    );
    const order = rows[0];
    if (!order) return reply.status(404).send({ error: 'Заказ не найден' });
    if (['cancelled', 'no_award'].includes(order.sourcing_status)) {
      return reply.status(409).send({ error: 'Заказ завершён — комментарий менять нельзя' });
    }
    const access = await assertOrderAccessForOrder(fastify.pool, user, order.id);
    if (!access.ok) return reply.status(403).send({ error: access.reason });

    // Запись без фактического изменения не должна плодить записи в журнале.
    if ((order.comment ?? null) === next) return { data: { comment: next } };

    await fastify.pool.query(
      `UPDATE supplier_orders SET comment = $2, updated_at = now() WHERE id = $1`,
      [order.id, next],
    );
    await appendOrderAudit(fastify.pool, {
      orderId: order.id, action: 'comment_changed', userId: user.id,
      changes: { from: order.comment ?? null, to: next }, projectId: order.project_id,
    });
    return { data: { comment: next } };
  });

  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    // ФИО акторов согласования: SELECT * отдаёт только идентификаторы, а карточка показывает,
    // кто отправил предложение и кто его подтвердил.
    const { rows } = await fastify.pool.query(
      `SELECT so.*,
              ru.full_name AS approval_requested_by_name,
              au.full_name AS approved_by_name
         FROM supplier_orders so
         LEFT JOIN users ru ON ru.id = so.approval_requested_by
         LEFT JOIN users au ON au.id = so.approved_by
        WHERE so.id = $1 AND so.kind = 'sourcing'`,
      [request.params.id],
    );
    const lot = rows[0];
    if (!lot) return reply.status(404).send({ error: 'Заказ не найден' });

    const [items, aggItems, sources, offers, priceLines, deliverySchedule, invoices] = await Promise.all([
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
      // Счета заказа (0078). Действующие идут первыми; ключ S3 наружу не отдаём.
      fastify.pool.query(
        `SELECT i.id, i.invoice_revision, i.invoice_no, to_char(i.invoice_date, 'YYYY-MM-DD') AS invoice_date,
                i.amount, i.vat_amount, i.supplier_name, i.supplier_inn, i.source,
                i.file_name, i.file_size, i.note,
                i.recognition_status, i.recognition_error, i.match_result, i.match_status,
                i.superseded_at, i.superseded_reason, i.created_at,
                u.full_name AS uploaded_by_name
           FROM supplier_order_invoices i
           LEFT JOIN users u ON u.id = i.uploaded_by
          WHERE i.order_id = $1
          ORDER BY i.superseded_at NULLS FIRST, i.created_at DESC`,
        [lot.id],
      ),
    ]);

    // «Нужен новый счёт» ВЫЧИСЛЯЕМ, а не храним флагом: флаг пришлось бы гасить в трёх местах
    // (загрузка счёта, отмена, смена поставщика), и любой пропуск оставил бы вечное предупреждение.
    const needsNewInvoice =
      lot.sourcing_status === 'awarded'
      && Number(lot.invoice_revision ?? 1) > 1
      && !invoices.rows.some(
        (i) => i.superseded_at == null && Number(i.invoice_revision) >= Number(lot.invoice_revision ?? 1),
      );

    return {
      data: {
        ...lot,
        items: items.rows,
        aggItems: aggItems.rows,
        sources: sources.rows,
        offers: offers.rows,
        priceLines: priceLines.rows,
        deliverySchedule: deliverySchedule.rows,
        invoices: invoices.rows,
        needs_new_invoice: needsNewInvoice,
      },
    };
  });
}
