import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit, recordAuditBatch } from '../../lib/audit.js';
import { withImageSrc } from '../../lib/projectImage.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId, bucketBy, ITEMS_CANONICAL_ORDER_BY } from '../../lib/estimate-detail.js';
import { assertEstimateAccess, ChatAccessError, isContractor } from '../../lib/chat/access.js';
import {
  assignItemContractorsSchema,
  clearItemContractorsSchema,
  type AssignItemContractorsInput,
} from '@estimat/shared';

// Эффективный объём подрядчика по строке: qty, либо доля от объёма, либо весь объём (оба NULL).
// Алиасы: eic — estimate_item_contractors, ei — estimate_items.
const EFFECTIVE = `COALESCE(eic.assigned_qty, ei.quantity * eic.assigned_percent / 100.0, ei.quantity)`;
const EPS = 1e-6;

// Один пункт «сырого плана» назначения до блокировки/расчёта.
type PlanItem = { itemId: string; percent?: number; qty?: number; remainder?: boolean };

export default async function contractorRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // ============================================================
  // GET /api/contractors/estimates — объекты/сметы для раздела + счётчики
  // ============================================================
  fastify.get('/estimates', async (request) => {
    const user = request.currentUser;

    // Подрядчик: объекты, назначенные его организации (project_contractors); счётчики —
    // по его строкам. Объект без заведённой сметы тоже виден (estimate_id=null → некликабелен).
    if (isContractor(user)) {
      if (!user.orgId) return { data: [] };
      const { rows } = await fastify.pool.query(
        `SELECT e.id AS estimate_id, e.project_id, e.work_type,
                p.code AS project_code, p.name AS project_name,
                p.address, p.image_url,
                cc.name AS cost_category_name,
                COUNT(DISTINCT eic.item_id)::int AS items_total,
                COALESCE(SUM(${EFFECTIVE} * ei.unit_price), 0)::numeric AS my_amount
           FROM project_contractors pc
           JOIN projects p        ON p.id = pc.project_id
           LEFT JOIN estimates e  ON e.project_id = p.id
           LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
           LEFT JOIN estimate_item_contractors eic
                  ON eic.estimate_id = e.id AND eic.contractor_id = pc.contractor_id
           LEFT JOIN estimate_items ei ON ei.id = eic.item_id
          WHERE pc.contractor_id = $1
          GROUP BY e.id, p.id, cc.name
          ORDER BY p.code`,
        [user.orgId],
      );
      return { data: rows.map((r) => withImageSrc(fastify, r)) };
    }

    // Инженер/админ/менеджер: все объекты (карточка = объект, у объекта одна смета).
    // Корень — projects, смета через LEFT JOIN: объекты без заведённой сметы тоже
    // попадают в галерею (estimate_id = NULL, счётчики 0). Счётчики назначено/без
    // подрядчика/нераспределённый объём — по строкам сметы объекта.
    const { rows } = await fastify.pool.query(
      `SELECT e.id AS estimate_id, e.project_id, e.work_type, e.total_amount,
              p.code AS project_code, p.name AS project_name,
              p.address, p.image_url,
              cc.name AS cost_category_name,
              COUNT(ei.id)::int AS items_total,
              COUNT(ei.id) FILTER (WHERE asg.cnt > 0)::int AS items_assigned,
              COUNT(ei.id) FILTER (WHERE COALESCE(asg.cnt, 0) = 0)::int AS items_unassigned,
              COALESCE(SUM(GREATEST(ei.quantity - COALESCE(asg.effective, 0), 0) * ei.unit_price), 0)::numeric
                AS unassigned_amount
         FROM projects p
         LEFT JOIN estimates e        ON e.project_id = p.id
         LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
         LEFT JOIN estimate_items ei  ON ei.estimate_id = e.id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS cnt,
                  SUM(COALESCE(eic.assigned_qty, ei.quantity * eic.assigned_percent / 100.0, ei.quantity)) AS effective
             FROM estimate_item_contractors eic
            WHERE eic.item_id = ei.id
         ) asg ON true
        GROUP BY p.id, e.id, cc.name
        ORDER BY p.code`,
    );
    return { data: rows.map((r) => withImageSrc(fastify, r)) };
  });

  // ============================================================
  // GET /api/contractors/estimates/:id/assignments — карта назначений сметы (инженер)
  // ============================================================
  fastify.get<{ Params: { id: string } }>('/estimates/:id/assignments', async (request, reply) => {
    try {
      await assertEstimateAccess(fastify.pool, request.params.id, request.currentUser);
    } catch (err) {
      if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }
    const { rows } = await fastify.pool.query(
      `SELECT eic.id, eic.item_id, eic.contractor_id, eic.assigned_qty, eic.assigned_percent,
              eic.assigned_at,
              ${EFFECTIVE} AS effective_qty,
              o.name AS contractor_name,
              u.full_name AS assigned_by_name
         FROM estimate_item_contractors eic
         JOIN estimate_items ei  ON ei.id = eic.item_id
         LEFT JOIN organizations o ON o.id = eic.contractor_id
         LEFT JOIN users u         ON u.id = eic.assigned_by
        WHERE eic.estimate_id = $1
        ORDER BY eic.assigned_at`,
      [request.params.id],
    );
    return { data: rows };
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
                eic.contractor_id   AS my_contractor_id,
                eic.assigned_qty    AS my_assigned_qty,
                eic.assigned_percent AS my_assigned_percent,
                ${EFFECTIVE}        AS my_effective_qty
           FROM estimate_item_contractors eic
           JOIN estimate_items ei       ON ei.id = eic.item_id
           LEFT JOIN rates r            ON ei.rate_id = r.id
           LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
           LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
           LEFT JOIN project_zones z    ON ei.zone_id = z.id
           LEFT JOIN room_types rt      ON ei.room_type_id = rt.id
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
      const materialsByItem = bucketBy(materials, (m) => m.item_id as string);
      const itemsWithMaterials = items.rows.map((it) => ({
        ...it,
        materials: materialsByItem.get(it.id as string) ?? [],
      }));

      return { data: { items: itemsWithMaterials } };
    },
  );

  // ============================================================
  // POST /api/contractors/assignments — назначить подрядчика на строки
  // ============================================================
  fastify.post(
    '/assignments',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = assignItemContractorsSchema.parse(request.body) as AssignItemContractorsInput;
      const userId = request.currentUser.id;
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Сформировать сырой план (item → желаемый qty/percent/remainder).
        const plan: PlanItem[] = [];
        if (body.mode === 'percent') {
          for (const id of body.itemIds) plan.push({ itemId: id, percent: body.percent });
        } else if (body.mode === 'remainder') {
          for (const id of body.itemIds) plan.push({ itemId: id, remainder: true });
        } else if (body.mode === 'qty') {
          for (const a of body.assignments) plan.push({ itemId: a.itemId, qty: a.assignedQty });
        } else {
          // cost_type: все ТЕКУЩИЕ строки вида затрат сметы
          const { rows } = await client.query(
            'SELECT id FROM estimate_items WHERE estimate_id = $1 AND cost_type_id = $2',
            [body.estimateId, body.costTypeId],
          );
          for (const r of rows) {
            plan.push(
              body.percent != null
                ? { itemId: r.id, percent: body.percent }
                : { itemId: r.id, remainder: true },
            );
          }
        }

        if (plan.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Нет строк для назначения' });
        }

        // 2. Заблокировать строки (mutex по строке — сериализует параллельные назначения).
        const itemIds = [...new Set(plan.map((p) => p.itemId))];
        const locked = await client.query(
          'SELECT id, estimate_id, quantity, unit_price FROM estimate_items WHERE id = ANY($1) FOR UPDATE',
          [itemIds],
        );
        const byId = new Map<string, { estimate_id: string; quantity: string }>(
          locked.rows.map((r) => [r.id as string, r]),
        );
        if (byId.size !== itemIds.length) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Некоторые строки сметы не найдены' });
        }

        // 3. Рассчитать итог по каждой строке, проверить, что сумма объёмов ≤ объёма строки.
        const toUpsert: { itemId: string; estimateId: string; qty: number | null; percent: number | null }[] = [];
        for (const p of plan) {
          const row = byId.get(p.itemId)!;
          const q = Number(row.quantity);
          const oth = await client.query(
            `SELECT COALESCE(SUM(COALESCE(assigned_qty, $1::numeric * assigned_percent / 100.0, $1::numeric)), 0) AS s
               FROM estimate_item_contractors
              WHERE item_id = $2 AND contractor_id <> $3`,
            [q, p.itemId, body.contractorId],
          );
          const others = Number(oth.rows[0].s);

          let qty: number | null = null;
          let percent: number | null = null;
          let effective: number;
          if (p.percent != null) {
            percent = p.percent;
            effective = (q * p.percent) / 100;
          } else if (p.qty != null) {
            qty = p.qty;
            effective = p.qty;
          } else {
            // remainder — весь нераспределённый объём строки
            const rem = q - others;
            if (rem <= EPS) continue; // остатка нет — пропускаем строку
            qty = Math.round(rem * 1e4) / 1e4;
            effective = qty;
          }

          if (others + effective > q + EPS) {
            await client.query('ROLLBACK');
            return reply
              .status(400)
              .send({ error: `Превышен объём строки: уже распределено ${others}, объём строки ${q}` });
          }
          toUpsert.push({ itemId: p.itemId, estimateId: row.estimate_id, qty, percent });
        }

        if (toUpsert.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Нечего назначать: у выбранных строк нет свободного объёма' });
        }

        // 4. UPSERT назначений + аудит.
        const auditInputs = [];
        for (const u of toUpsert) {
          const { rows } = await client.query(
            `INSERT INTO estimate_item_contractors
               (item_id, estimate_id, contractor_id, assigned_qty, assigned_percent, assigned_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (item_id, contractor_id)
               DO UPDATE SET assigned_qty = EXCLUDED.assigned_qty,
                             assigned_percent = EXCLUDED.assigned_percent,
                             assigned_by = EXCLUDED.assigned_by,
                             updated_at = now()
             RETURNING *`,
            [u.itemId, u.estimateId, body.contractorId, u.qty, u.percent, userId],
          );
          auditInputs.push({
            estimateId: u.estimateId,
            entityType: 'estimate_item_contractor',
            entityId: rows[0].id as string,
            action: 'update',
            userId,
            changes: { after: rows[0] },
          });
        }
        await recordAuditBatch(client, auditInputs);

        // Авто-синк: объекты затронутых смет становятся видимыми подрядчику в его кабинете.
        // Снятие исполнителя (DELETE /assignments) эту связку НЕ убирает.
        const affectedEstimateIds = [...new Set(toUpsert.map((u) => u.estimateId))];
        await client.query(
          `INSERT INTO project_contractors (project_id, contractor_id, assigned_by)
           SELECT DISTINCT e.project_id, $2::uuid, $3::uuid
             FROM estimates e
            WHERE e.id = ANY($1::uuid[]) AND e.project_id IS NOT NULL
           ON CONFLICT (project_id, contractor_id) DO NOTHING`,
          [affectedEstimateIds, body.contractorId, userId],
        );

        await client.query('COMMIT');

        // 5. Realtime по каждой затронутой смете.
        const estimateIds = [...new Set(toUpsert.map((u) => u.estimateId))];
        for (const eid of estimateIds) {
          const projectId = await loadProjectId(fastify.pool, eid);
          await emitEstimateChanged(fastify, 'contractor_set', eid, projectId, userId);
        }

        return { data: { assigned: toUpsert.length } };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // ============================================================
  // DELETE /api/contractors/assignments — снять подрядчика(ов) со строк
  // ============================================================
  fastify.delete(
    '/assignments',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request) => {
      const body = clearItemContractorsSchema.parse(request.body);
      const userId = request.currentUser.id;
      const values: unknown[] = [body.itemIds];
      let sql = 'DELETE FROM estimate_item_contractors WHERE item_id = ANY($1)';
      if (body.contractorId) {
        values.push(body.contractorId);
        sql += ` AND contractor_id = $${values.length}`;
      }
      sql += ' RETURNING *';
      const { rows } = await fastify.pool.query(sql, values);
      if (rows.length === 0) return { data: { cleared: 0 } };

      await recordAuditBatch(
        fastify.pool,
        rows.map((r) => ({
          estimateId: r.estimate_id as string,
          entityType: 'estimate_item_contractor',
          entityId: r.id as string,
          action: 'delete',
          userId,
          changes: { before: r },
        })),
      );

      const estimateIds = [...new Set(rows.map((r) => r.estimate_id as string))];
      for (const eid of estimateIds) {
        const projectId = await loadProjectId(fastify.pool, eid);
        await emitEstimateChanged(fastify, 'contractor_cleared', eid, projectId, userId);
      }
      return { data: { cleared: rows.length } };
    },
  );
}
