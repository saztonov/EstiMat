import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { isContractor } from '../../lib/chat/access.js';
import { createMaterialRequestSchema, type CreateMaterialRequestInput } from '@estimat/shared';

// Ключ свёртки материала — ДОЛЖЕН совпадать с клиентским aggKey (aggregateMaterials.ts):
//   справочный материал → id:<material_id>|<ед>, текстовый → txt:<name>|<ед> (нормализовано).
function aggKey(materialId: string | null, name: string, unit: string): string {
  const u = (unit ?? '').trim().toLowerCase();
  return materialId ? `id:${materialId}|${u}` : `txt:${name.trim().toLowerCase()}|${u}`;
}

// Ключ строки заявки для сверки с видимой сводкой: (вид работ, свёртка материала).
const lineKey = (costTypeId: string | null, key: string): string => `${costTypeId ?? ''}|${key}`;

export default async function materialRequestRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // Доступ подрядчика к смете объекта (проект назначен его организации).
  async function assertContractorEstimateAccess(estimateId: string, orgId: string): Promise<boolean> {
    const { rows } = await fastify.pool.query(
      `SELECT 1 FROM estimates e
         JOIN project_contractors pc ON pc.project_id = e.project_id
        WHERE e.id = $1 AND pc.contractor_id = $2`,
      [estimateId, orgId],
    );
    return rows.length > 0;
  }

  // Видимая подрядчику сводка материалов сметы: множество ключей (cost_type_id, agg_key)
  // по его назначенным строкам. Заявка принимается только по этим материалам.
  async function visibleMaterialKeys(estimateId: string, orgId: string): Promise<Set<string>> {
    const { rows } = await fastify.pool.query(
      `SELECT ei.cost_type_id, em.material_id, em.unit,
              COALESCE(mc.name, em.description, 'Материал') AS name
         FROM estimate_item_contractors eic
         JOIN estimate_items ei     ON ei.id = eic.item_id
         JOIN estimate_materials em ON em.item_id = ei.id
         LEFT JOIN material_catalog mc ON em.material_id = mc.id
        WHERE eic.estimate_id = $1 AND eic.contractor_id = $2`,
      [estimateId, orgId],
    );
    const set = new Set<string>();
    for (const r of rows) {
      set.add(lineKey(r.cost_type_id ?? null, aggKey(r.material_id ?? null, r.name, r.unit)));
    }
    return set;
  }

  // ============================================================
  // POST /api/material-requests — создать заявку подрядчика на материалы
  // ============================================================
  fastify.post('/', { preHandler: [requireRole('contractor')] }, async (request, reply) => {
    const user = request.currentUser;
    if (!user.orgId) return reply.status(400).send({ error: 'Пользователь не привязан к организации' });

    const body = createMaterialRequestSchema.parse(request.body) as CreateMaterialRequestInput;

    if (!(await assertContractorEstimateAccess(body.estimateId, user.orgId))) {
      return reply.status(403).send({ error: 'Объект не назначен вашей организации' });
    }

    // Принять только строки по видимым подрядчику материалам (защита от заказа чужого).
    // Превышение объёма НЕ блокируем — это отражается статусом «Сверх сметы» на клиенте.
    const visible = await visibleMaterialKeys(body.estimateId, user.orgId);
    const lines = body.lines.filter(
      (l) => l.quantity > 0 && visible.has(lineKey(l.costTypeId, l.aggKey)),
    );
    if (lines.length === 0) {
      return reply.status(400).send({ error: 'Нет допустимых строк заявки' });
    }

    const projectRes = await fastify.pool.query('SELECT project_id FROM estimates WHERE id = $1', [body.estimateId]);
    const projectId = projectRes.rows[0]?.project_id ?? null;

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: reqRows } = await client.query(
        `INSERT INTO material_requests (estimate_id, project_id, contractor_id, status, created_by)
         VALUES ($1, $2, $3, 'confirmed', $4) RETURNING id`,
        [body.estimateId, projectId, user.orgId, user.id],
      );
      const requestId = reqRows[0].id as string;
      for (const l of lines) {
        await client.query(
          `INSERT INTO material_request_items
             (request_id, cost_type_id, agg_key, material_id, material_name, unit, quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [requestId, l.costTypeId, l.aggKey, l.materialId, l.name, l.unit, l.quantity],
        );
      }
      await client.query('COMMIT');
      return reply.status(201).send({ data: { id: requestId, lines: lines.length } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // GET /api/material-requests/ordered?estimateId=&contractorIds=
  //   Заказанное количество по материалам (cost_type_id, agg_key).
  //   Подрядчик — только по своей организации; сотрудник — по фильтру или суммарно.
  // ============================================================
  fastify.get<{ Querystring: { estimateId?: string; contractorIds?: string } }>(
    '/ordered',
    async (request, reply) => {
      const user = request.currentUser;
      const estimateId = request.query.estimateId;
      if (!estimateId) return reply.status(400).send({ error: 'Не указан estimateId' });

      const values: unknown[] = [estimateId];
      let where = 'mr.estimate_id = $1';

      if (isContractor(user)) {
        if (!user.orgId) return { data: [] };
        values.push(user.orgId);
        where += ` AND mr.contractor_id = $${values.length}`;
      } else if (request.query.contractorIds) {
        const ids = request.query.contractorIds.split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length) {
          values.push(ids);
          where += ` AND mr.contractor_id = ANY($${values.length})`;
        }
      }

      const { rows } = await fastify.pool.query(
        `SELECT mri.cost_type_id, mri.agg_key, SUM(mri.quantity)::numeric AS ordered_qty
           FROM material_request_items mri
           JOIN material_requests mr ON mr.id = mri.request_id
          WHERE ${where}
          GROUP BY mri.cost_type_id, mri.agg_key`,
        values,
      );
      return { data: rows };
    },
  );
}
