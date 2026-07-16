import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { isContractor } from '../../lib/chat/access.js';
import {
  aggKey,
  lineKey,
  createMaterialRequestSchema,
  type CreateMaterialRequestInput,
} from '@estimat/shared';
import {
  exportMaterialRequestXlsx,
  MaterialRequestExportError,
} from '../../lib/material-request-export/index.js';
import { lockEstimateRequests } from '../../lib/material-requests/access.js';

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
  // Исполнитель (db) передаётся явно — при создании заявки читаем внутри транзакции под
  // advisory-lock, чтобы сводка была консистентна с моментом вставки строк заявки.
  async function visibleMaterialKeys(
    db: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> },
    estimateId: string,
    orgId: string,
  ): Promise<Set<string>> {
    const { rows } = await db.query(
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
      await lockEstimateRequests(client, body.estimateId);

      // Принять только строки по видимым подрядчику материалам (защита от заказа чужого).
      // Превышение объёма НЕ блокируем — это отражается статусом «Сверх сметы» на клиенте.
      const visible = await visibleMaterialKeys(client, body.estimateId, user.orgId);
      const lines = body.lines.filter(
        (l) => l.quantity > 0 && visible.has(lineKey(l.costTypeId, l.aggKey)),
      );
      if (lines.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Нет допустимых строк заявки' });
      }

      // Номер заявки в рамках объекта: блокируем строку проекта, чтобы параллельные заявки
      // одного объекта не получили одинаковый request_no.
      if (projectId) await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
      const { rows: noRows } = await client.query(
        'SELECT COALESCE(MAX(request_no), 0) + 1 AS next_no FROM material_requests WHERE project_id = $1',
        [projectId],
      );
      const requestNo = Number(noRows[0].next_no);

      const { rows: reqRows } = await client.query(
        `INSERT INTO material_requests (estimate_id, project_id, contractor_id, status, request_type, request_no, created_by)
         VALUES ($1, $2, $3, 'created', $4, $5, $6) RETURNING id`,
        [body.estimateId, projectId, user.orgId, body.requestType, requestNo, user.id],
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
        data: { id: requestId, requestNo, number, status: 'created', lines: lines.length },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /api/material-requests/:id/export — выгрузка заявки в Excel (для поставщика)
  //   Доступ: владелец-подрядчик (своя организация) или внутренние роли.
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/export', async (request, reply) => {
    const user = request.currentUser;
    try {
      const { buffer, fileName, header } = await exportMaterialRequestXlsx(fastify.pool, request.params.id);
      if (isContractor(user) && header.contractor_id !== user.orgId) {
        return reply.status(403).send({ error: 'Чужая заявка' });
      }
      reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header(
        'Content-Disposition',
        `attachment; filename="request.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(buffer);
    } catch (e) {
      if (e instanceof MaterialRequestExportError) {
        return reply.status(e.status).send({ error: e.message });
      }
      throw e;
    }
  });

  // ============================================================
  // GET /api/material-requests/ordered?estimateId=&contractorIds=
  //   Заказанное количество и цена по материалам (cost_type_id, agg_key) + число заявок.
  //   Подрядчик — только по своей организации; сотрудник — по фильтру или суммарно.
  //
  //   Цена берётся из оформленной закупки, а не из сметы: сметный unit_price материала заполнен
  //   у единиц позиций, и показывать его как стоимость материалов нельзя. Связь с заявкой — через
  //   supplier_order_items (у закупки supplier_orders.request_id не заполняется: один лот сводит
  //   несколько заявок).
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
        if (!user.orgId) return { data: [], meta: { requestCount: 0 } };
        values.push(user.orgId);
        where += ` AND mr.contractor_id = $${values.length}`;
      } else if (request.query.contractorIds) {
        const ids = request.query.contractorIds.split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length) {
          values.push(ids);
          where += ` AND mr.contractor_id = ANY($${values.length})`;
        }
      }

      // priced_qty/priced_amount отдаём раздельно: цена по материалу — средневзвешенная по
      // фактически заказанному количеству (закупок с разной ценой может быть несколько).
      // Цена — без НДС, как она сохранена в строке заказа.
      const { rows } = await fastify.pool.query(
        `WITH ordered AS (
           SELECT mri.cost_type_id, mri.agg_key, SUM(mri.quantity)::numeric AS ordered_qty
             FROM material_request_items mri
             JOIN material_requests mr ON mr.id = mri.request_id
            WHERE ${where} AND mr.status <> 'cancelled'
            GROUP BY mri.cost_type_id, mri.agg_key
         ), priced AS (
           SELECT soi.cost_type_id,
                  soi.agg_key,
                  SUM(soi.quantity)::numeric                  AS priced_qty,
                  SUM(soi.quantity * pl.unit_price)::numeric  AS priced_amount
             FROM supplier_order_items soi
             JOIN supplier_orders so
               ON so.id = soi.order_id AND so.kind = 'sourcing' AND so.sourcing_status = 'awarded'
             JOIN supplier_order_price_lines pl
               ON pl.order_id = soi.order_id AND pl.agg_key = soi.agg_key
             JOIN material_requests mr ON mr.id = soi.request_id
            WHERE ${where} AND mr.status <> 'cancelled'
            GROUP BY soi.cost_type_id, soi.agg_key
         )
         SELECT o.cost_type_id, o.agg_key, o.ordered_qty, p.priced_qty, p.priced_amount
           FROM ordered o
           LEFT JOIN priced p
             ON p.agg_key = o.agg_key
            AND p.cost_type_id IS NOT DISTINCT FROM o.cost_type_id`,
        values,
      );

      // Счётчик для виджета в шапке — иначе клиент тянул бы ради одного числа список заявок.
      const cnt = await fastify.pool.query(
        `SELECT COUNT(*)::int AS n FROM material_requests mr WHERE ${where}`,
        values,
      );
      return { data: rows, meta: { requestCount: cnt.rows[0]?.n ?? 0 } };
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
        `SELECT mr.id, mr.request_no, mr.status, mr.request_type, mr.created_at,
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
