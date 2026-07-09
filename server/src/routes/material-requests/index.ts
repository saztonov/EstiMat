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

    const projectRes = await fastify.pool.query(
      `SELECT e.project_id, p.code
         FROM estimates e
         LEFT JOIN projects p ON p.id = e.project_id
        WHERE e.id = $1`,
      [body.estimateId],
    );
    const projectId = projectRes.rows[0]?.project_id ?? null;
    const projectCode = projectRes.rows[0]?.code ?? null;

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      // Номер заявки в рамках объекта: блокируем строку проекта, чтобы параллельные заявки
      // одного объекта не получили одинаковый request_no.
      if (projectId) await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
      const { rows: noRows } = await client.query(
        'SELECT COALESCE(MAX(request_no), 0) + 1 AS next_no FROM material_requests WHERE project_id = $1',
        [projectId],
      );
      const requestNo = Number(noRows[0].next_no);

      const { rows: reqRows } = await client.query(
        `INSERT INTO material_requests (estimate_id, project_id, contractor_id, status, request_no, created_by)
         VALUES ($1, $2, $3, 'sent', $4, $5) RETURNING id`,
        [body.estimateId, projectId, user.orgId, requestNo, user.id],
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
      const number = `${projectCode ?? 'ЗМ'}-${String(requestNo).padStart(2, '0')}`;
      return reply.status(201).send({
        data: { id: requestId, requestNo, number, status: 'sent', lines: lines.length },
      });
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

  // ============================================================
  // GET /api/material-requests?estimateId=&contractorIds=
  //   Список созданных заявок по смете (для модалки «Созданные заявки»).
  //   Подрядчик — только заявки своей организации; сотрудник — все, опц. фильтр contractorIds.
  // ============================================================
  fastify.get<{ Querystring: { estimateId?: string; contractorIds?: string } }>(
    '/',
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
        `SELECT mr.id, mr.request_no, mr.status, mr.created_at,
                p.code AS project_code, p.name AS project_name,
                org.name AS contractor_name,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'name', mri.material_name,
                      'unit', mri.unit,
                      'quantity', mri.quantity,
                      'costTypeName', ct.name
                    )
                    ORDER BY ct.name NULLS LAST, mri.material_name
                  ) FILTER (WHERE mri.id IS NOT NULL),
                  '[]'
                ) AS items
           FROM material_requests mr
           LEFT JOIN projects p                ON p.id  = mr.project_id
           LEFT JOIN organizations org         ON org.id = mr.contractor_id
           LEFT JOIN material_request_items mri ON mri.request_id = mr.id
           LEFT JOIN cost_types ct             ON ct.id = mri.cost_type_id
          WHERE ${where}
          GROUP BY mr.id, p.code, p.name, org.name
          ORDER BY mr.request_no DESC NULLS LAST, mr.created_at DESC`,
        values,
      );

      const data = rows.map((r) => ({
        ...r,
        number: `${r.project_code ?? 'ЗМ'}-${String(r.request_no ?? 0).padStart(2, '0')}`,
      }));
      return { data };
    },
  );
}
