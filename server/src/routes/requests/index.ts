import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { isContractor } from '../../lib/chat/access.js';
import {
  createRequestSchema,
  requestRevisionSchema,
  completeRevisionSchema,
  directSupplierSchema,
  createPaymentSchema,
  requestFileMetaSchema,
  rpApplicationSchema,
  rpSendSchema,
  rpLetterTextSchema,
  rpSentDateSchema,
  cancelRequestSchema,
  orderEditSchema,
  setFileRejectionSchema,
} from '@estimat/shared';
import {
  assertContractorEstimateAccess,
  visibleMaterialKeys,
  lineKey,
  appendRequestAudit,
} from '../../lib/material-requests/access.js';
import { recalcRequestStatus } from '../../lib/requests/status-recalc.js';
import { hasActiveAllocations, hasFrozenAllocations, releaseFormingAllocations, appendOrderAudit } from '../../lib/supplier-orders/helpers.js';
import { guardedStreamUpload, FileGuardError } from '../../lib/uploads/file-guard.js';
import { exportMaterialRequestXlsx, MaterialRequestExportError } from '../../lib/material-request-export/index.js';
import { getPayHubClient } from '../../lib/payhub/client.js';
import { PayHubApiError, PayHubWaitingConfigError } from '../../lib/payhub/errors.js';
import {
  rpExternalRef,
  resolveLetterConfig,
  buildLetterContent,
  ensureRpLetter,
  syncRpLetterAttachments,
  getRpSender,
  resolveRecipient,
} from '../../lib/payhub/rp-sync.js';
import { registerRequestCommentRoutes } from './comments.js';

const INTERNAL_ROLES = new Set(['admin', 'engineer', 'manager']);
const FILE_LIMIT = 50 * 1024 * 1024; // 50 МБ на файл (per-route)

const canonicalHash = (obj: unknown): string =>
  createHash('sha256').update(JSON.stringify(obj)).digest('hex');

const requestNumber = (projectCode: string | null, no: number | null): string =>
  `${projectCode ?? 'ЗМ'}-${String(no ?? 0).padStart(2, '0')}`;

// Атомарная смена статуса с optimistic lock: false — версия рассинхронизирована (конкурентная правка).
async function atomicSetStatus(
  client: PoolClient,
  id: string,
  expectedVersion: number,
  newStatus: string,
  actorId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE material_requests
        SET status = $2, status_changed_at = now(), status_changed_by = $3, row_version = row_version + 1
      WHERE id = $1 AND row_version = $4`,
    [id, newStatus, actorId, expectedVersion],
  );
  return rowCount === 1;
}

export default async function requestRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // Чат-комментарии к заявке (общение подрядчик ↔ снабжение).
  registerRequestCommentRoutes(fastify);

  const isInternal = (role: string) => INTERNAL_ROLES.has(role);

  type MrRow = Record<string, any>;
  type LoadResult = { ok: true; row: MrRow } | { ok: false; code: number; msg: string };

  // Загрузка заявки со скоупом доступа: internal — любую; contractor — только свою.
  async function loadScoped(id: string, user: { role: string; orgId?: string | null }): Promise<LoadResult> {
    const { rows } = await fastify.pool.query(`SELECT * FROM material_requests WHERE id = $1`, [id]);
    const row = rows[0];
    if (!row) return { ok: false, code: 404, msg: 'Заявка не найдена' };
    if (isInternal(user.role)) return { ok: true, row };
    if (user.role === 'contractor' && row.contractor_id === user.orgId) return { ok: true, row };
    return { ok: false, code: 403, msg: 'Нет доступа' };
  }

  // ============================================================
  // GET / — единый список заявок (ролевой скоуп + фильтры + пагинация)
  // ============================================================
  fastify.get<{
    Querystring: {
      type?: string; status?: string; projectId?: string; estimateId?: string; contractorId?: string;
      dateFrom?: string; dateTo?: string; q?: string; limit?: string; offset?: string;
    };
  }>('/', async (request, reply) => {
    const user = request.currentUser;
    const q = request.query;
    const values: unknown[] = [];
    const where: string[] = [];

    if (isContractor(user)) {
      if (!user.orgId) return { data: [], meta: { total: 0 } };
      values.push(user.orgId);
      where.push(`mr.contractor_id = $${values.length}`);
    } else if (q.contractorId) {
      values.push(q.contractorId);
      where.push(`mr.contractor_id = $${values.length}`);
    }

    if (q.type) {
      values.push(q.type);
      where.push(`mr.request_type = $${values.length}`);
    }
    if (q.status) {
      // status может быть списком через запятую (напр. реестр РП: rp_sent,rp_paid).
      const statuses = q.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length) {
        values.push(statuses);
        where.push(`mr.status = ANY($${values.length}::text[])`);
      }
    }
    if (q.projectId) {
      values.push(q.projectId);
      where.push(`mr.project_id = $${values.length}`);
    }
    if (q.estimateId) {
      values.push(q.estimateId);
      where.push(`mr.estimate_id = $${values.length}`);
    }
    if (q.dateFrom) {
      values.push(q.dateFrom);
      where.push(`mr.created_at >= $${values.length}`);
    }
    if (q.dateTo) {
      values.push(q.dateTo);
      where.push(`mr.created_at < ($${values.length}::date + 1)`);
    }
    if (q.q) {
      values.push(`%${q.q}%`);
      where.push(`(mr.contractor_name ILIKE $${values.length} OR so.supplier_name ILIKE $${values.length}
                  OR (COALESCE(p.code,'') || '-' || lpad(coalesce(mr.request_no,0)::text,2,'0')) ILIKE $${values.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const offset = Math.max(Number(q.offset) || 0, 0);
    values.push(limit, offset);

    const { rows } = await fastify.pool.query(
      `SELECT mr.id, mr.request_no, mr.request_type, mr.status, mr.created_at,
              mr.row_version, mr.contractor_name, mr.contractor_inn, mr.project_name,
              p.code AS project_code,
              so.supplier_name, so.supplier_inn, so.amount AS order_amount, so.rp_number, so.rp_date,
              rl.payhub_reg_number, rl.payhub_url, rl.sync_status AS rp_sync_status,
              rl.payhub_letter_id, rl.subject AS rp_subject, rl.content AS rp_content,
              rl.invoice_number AS rp_invoice_number, rl.sent_date AS rp_sent_date,
              rl.letter_date AS rp_letter_date, rl.responsible_name AS rp_responsible_name,
              rl.created_at AS rp_created_at, rl.recipient_name, cu.full_name AS rp_author,
              (SELECT COALESCE(SUM(sop.amount), 0) FROM supplier_order_payments sop
                WHERE sop.order_id = so.id AND NOT sop.reversed) AS order_paid_amount,
              (SELECT count(*) FROM material_request_files f
                WHERE f.request_id = mr.id AND NOT f.superseded) AS files_count,
              (SELECT count(*) FROM material_request_items i WHERE i.request_id = mr.id) AS items_count,
              (SELECT r.reason FROM material_request_revisions r
                WHERE r.request_id = mr.id AND r.completed_at IS NULL
                ORDER BY r.requested_at DESC LIMIT 1) AS revision_reason,
              count(*) OVER() AS total
         FROM material_requests mr
         LEFT JOIN projects p ON p.id = mr.project_id
         LEFT JOIN supplier_orders so ON so.request_id = mr.id AND so.kind = 'direct'
         LEFT JOIN rp_letters rl ON rl.request_id = mr.id AND rl.sync_status <> 'annulled'
         LEFT JOIN users cu ON cu.id = rl.created_by
         ${whereSql}
        ORDER BY mr.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    const total = rows[0] ? Number(rows[0].total) : 0;
    const data = rows.map((r) => ({
      ...r,
      number: requestNumber(r.project_code, r.request_no),
    }));
    return { data, meta: { total } };
  });

  // ============================================================
  // GET /:id — карточка заявки
  // ============================================================
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const res = await loadScoped(request.params.id, request.currentUser);
    if (!res.ok) return reply.status(res.code).send({ error: res.msg });
    const mr = res.row;

    const [items, files, order, revisions, history] = await Promise.all([
      fastify.pool.query(
        `SELECT mri.material_name AS name, mri.unit, mri.quantity, ct.name AS cost_type_name
           FROM material_request_items mri
           LEFT JOIN cost_types ct ON ct.id = mri.cost_type_id
          WHERE mri.request_id = $1
          ORDER BY ct.name NULLS LAST, mri.material_name`,
        [mr.id],
      ),
      fastify.pool.query(
        `SELECT f.id, f.doc_type, f.file_name, f.file_size, f.mime_type, f.created_at,
                u.full_name AS created_by_name, u.role AS created_by_role,
                f.is_rejected, f.rejected_at, ru.full_name AS rejected_by_name
           FROM material_request_files f
           LEFT JOIN users u ON u.id = f.created_by
           LEFT JOIN users ru ON ru.id = f.rejected_by
          WHERE f.request_id = $1 AND NOT f.superseded
          ORDER BY f.created_at`,
        [mr.id],
      ),
      fastify.pool.query(
        `SELECT id, supplier_id, supplier_name, supplier_inn, amount, rp_number, rp_date,
                delivery_days, delivery_days_type, shipping_conditions, rp_comment, created_at
           FROM supplier_orders WHERE request_id = $1 AND kind = 'direct' LIMIT 1`,
        [mr.id],
      ),
      fastify.pool.query(
        `SELECT r.id, r.reason, r.response, r.requested_at, r.completed_at,
                ru.full_name AS requested_by_name, cu.full_name AS completed_by_name
           FROM material_request_revisions r
           LEFT JOIN users ru ON ru.id = r.requested_by
           LEFT JOIN users cu ON cu.id = r.completed_by
          WHERE r.request_id = $1 ORDER BY r.requested_at`,
        [mr.id],
      ),
      fastify.pool.query(
        `SELECT a.action, a.changes, a.created_at, u.full_name AS actor_name
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id
          WHERE a.entity_type = 'material_request' AND a.entity_id = $1
          ORDER BY a.created_at`,
        [mr.id],
      ),
    ]);

    let payments: { rows: unknown[] } = { rows: [] };
    if (order.rows[0]) {
      payments = await fastify.pool.query(
        `SELECT id, amount, paid_at, doc_number, comment, reversed, created_at
           FROM supplier_order_payments WHERE order_id = $1 ORDER BY created_at`,
        [order.rows[0].id],
      );
    }

    const rpLetter = await fastify.pool.query(
      `SELECT payhub_reg_number, payhub_url, payhub_status, sync_status, sent_at, last_error
         FROM rp_letters WHERE request_id = $1 AND sync_status <> 'annulled' LIMIT 1`,
      [mr.id],
    );

    return {
      data: {
        ...mr,
        number: requestNumber(null, mr.request_no),
        items: items.rows,
        files: files.rows,
        order: order.rows[0] ?? null,
        payments: payments.rows,
        revisions: revisions.rows,
        history: history.rows,
        rp_letter: rpLetter.rows[0] ?? null,
      },
    };
  });

  // ============================================================
  // POST / — создание заявки (contractor), сразу в статусе in_work
  // ============================================================
  fastify.post('/', { preHandler: [requireRole('contractor')] }, async (request, reply) => {
    const user = request.currentUser;
    if (!user.orgId) return reply.status(400).send({ error: 'Пользователь не привязан к организации' });
    const body = createRequestSchema.parse(request.body);

    // Идемпотентность по клиентскому ключу.
    const dup = await fastify.pool.query(
      `SELECT id, payload_hash, request_no FROM material_requests
        WHERE contractor_id = $1 AND create_request_id = $2`,
      [user.orgId, body.createRequestId],
    );
    const payloadHash = canonicalHash({ requestType: body.requestType, lines: body.lines });
    if (dup.rows[0]) {
      if (dup.rows[0].payload_hash && dup.rows[0].payload_hash !== payloadHash) {
        return reply.status(409).send({ error: 'Повтор ключа заявки с другими данными' });
      }
      return reply.status(200).send({ data: { id: dup.rows[0].id, deduped: true } });
    }

    if (!(await assertContractorEstimateAccess(fastify.pool, body.estimateId, user.orgId))) {
      return reply.status(403).send({ error: 'Объект не назначен вашей организации' });
    }

    const visible = await visibleMaterialKeys(fastify.pool, body.estimateId, user.orgId);
    const lines = body.lines.filter(
      (l) => l.quantity > 0 && visible.has(lineKey(l.costTypeId, l.aggKey)),
    );
    if (lines.length === 0) return reply.status(400).send({ error: 'Нет допустимых строк заявки' });

    const ctx = await fastify.pool.query(
      `SELECT e.project_id, e.work_type AS estimate_name, p.code AS project_code, p.name AS project_name,
              org.name AS contractor_name, org.inn AS contractor_inn
         FROM estimates e
         LEFT JOIN projects p ON p.id = e.project_id
         LEFT JOIN organizations org ON org.id = $2
        WHERE e.id = $1`,
      [body.estimateId, user.orgId],
    );
    const c = ctx.rows[0] ?? {};
    const projectId = c.project_id ?? null;

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      if (projectId) await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
      const { rows: noRows } = await client.query(
        'SELECT COALESCE(MAX(request_no), 0) + 1 AS next_no FROM material_requests WHERE project_id = $1',
        [projectId],
      );
      const requestNo = Number(noRows[0].next_no);

      const { rows: reqRows } = await client.query(
        `INSERT INTO material_requests
           (estimate_id, project_id, contractor_id, status, request_type, request_no,
            create_request_id, payload_hash, project_name, estimate_label, contractor_name, contractor_inn,
            status_changed_at, status_changed_by, created_by)
         VALUES ($1,$2,$3,'in_work',$4,$5,$6,$7,$8,$9,$10,$11, now(), $12, $12)
         RETURNING id`,
        [
          body.estimateId, projectId, user.orgId, body.requestType, requestNo,
          body.createRequestId, payloadHash, c.project_name ?? null, c.estimate_name ?? null,
          c.contractor_name ?? null, c.contractor_inn ?? null, user.id,
        ],
      );
      const requestId = reqRows[0].id as string;

      for (const l of lines) {
        await client.query(
          `INSERT INTO material_request_items
             (request_id, cost_type_id, agg_key, material_id, material_name, unit, quantity)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [requestId, l.costTypeId, l.aggKey, l.materialId, l.name, l.unit, l.quantity],
        );
      }

      // Прямой заказ при создании — только для собственной закупки (own_supply).
      // По РП (own_supplier) заказ оформляется отдельно через «Оформить РП»; по su10 — снабжением.
      if (body.supplierName && body.resultAmount && body.requestType === 'own_supply') {
        await client.query(
          `INSERT INTO supplier_orders (request_id, kind, supplier_name, supplier_inn, amount, created_by)
           VALUES ($1,'direct',$2,$3,$4,$5)`,
          [requestId, body.supplierName, body.supplierInn ?? null, body.resultAmount, user.id],
        );
      }

      await appendRequestAudit(client, {
        requestId, action: 'created', userId: user.id,
        changes: { requestType: body.requestType, lines: lines.length },
        estimateId: body.estimateId, projectId,
      });
      await recalcRequestStatus(client, requestId, user.id);
      await client.query('COMMIT');

      return reply.status(201).send({
        data: { id: requestId, requestNo, number: requestNumber(c.project_code, requestNo) },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/supplier — прямой выбор поставщика/заказ (владелец-подрядчик или internal)
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/supplier', async (request, reply) => {
    const user = request.currentUser;
    const res = await loadScoped(request.params.id, user);
    if (!res.ok) return reply.status(res.code).send({ error: res.msg });
    const mr = res.row;
    if (mr.status === 'delivered') return reply.status(409).send({ error: 'Заявка закрыта' });
    // Заявка «Оплата по РП» ведётся через «Оформить РП» / «Отправить РП», не через этот роут.
    if (mr.request_type === 'own_supplier') {
      return reply.status(400).send({ error: 'Для заявки «Оплата по РП» используйте «Оформить РП»' });
    }
    // По заявкам СУ-10 закупка ведётся снабжением через закупочные лоты — прямой заказ запрещён всем ролям.
    if (mr.request_type === 'su10') {
      return reply.status(400).send({ error: 'По заявке СУ-10 закупка ведётся через закупочные лоты' });
    }
    // Прямой маршрут выбора поставщика подрядчиком — только для собственной закупки (own_supply).
    if (user.role === 'contractor' && mr.request_type !== 'own_supply') {
      return reply.status(403).send({ error: 'Поставщика по этой заявке выбирает снабжение' });
    }
    const body = directSupplierSchema.parse(request.body);
    if (body.expectedVersion != null && body.expectedVersion !== mr.row_version) {
      return reply.status(409).send({ error: 'Заявка изменена, обновите страницу', rowVersion: mr.row_version });
    }

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO supplier_orders (request_id, kind, supplier_name, supplier_inn, amount, rp_number, rp_date, created_by)
         VALUES ($1,'direct',$2,$3,$4,$5,$6,$7)
         ON CONFLICT (request_id) WHERE kind = 'direct' AND request_id IS NOT NULL
         DO UPDATE SET supplier_name = EXCLUDED.supplier_name, supplier_inn = EXCLUDED.supplier_inn,
                       amount = EXCLUDED.amount, rp_number = EXCLUDED.rp_number, rp_date = EXCLUDED.rp_date`,
        [mr.id, body.supplierName, body.supplierInn ?? null, body.resultAmount, body.rpNumber ?? null, body.rpDate ?? null, user.id],
      );
      await appendRequestAudit(client, {
        requestId: mr.id, action: 'supplier_selected', userId: user.id,
        changes: { supplierName: body.supplierName, amount: body.resultAmount },
        estimateId: mr.estimate_id, projectId: mr.project_id,
      });
      const status = await recalcRequestStatus(client, mr.id, user.id);
      await client.query('COMMIT');
      return { data: { id: mr.id, status } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/payments — регистрация оплаты по заказу (internal)
  // ============================================================
  fastify.post<{ Params: { id: string } }>(
    '/:id/payments',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const user = request.currentUser;
      const body = createPaymentSchema.parse(request.body);
      const mrRes = await fastify.pool.query(
        `SELECT request_type, status FROM material_requests WHERE id = $1`,
        [request.params.id],
      );
      const mr = mrRes.rows[0];
      if (!mr) return reply.status(404).send({ error: 'Заявка не найдена' });
      // По РП-маршруту оплату регистрируем только после отправки РП.
      if (mr.request_type === 'own_supplier' && mr.status !== 'rp_sent' && mr.status !== 'rp_paid') {
        return reply.status(409).send({ error: 'Оплату можно регистрировать после отправки РП' });
      }

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // Блокируем заказ на время регистрации оплаты и пересчёта (гонка частичных оплат).
        const orderRes = await client.query(
          `SELECT id FROM supplier_orders WHERE request_id = $1 AND kind = 'direct' LIMIT 1 FOR UPDATE`,
          [request.params.id],
        );
        const order = orderRes.rows[0];
        if (!order) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Сначала выберите поставщика (заказ отсутствует)' });
        }
        // Идемпотентность по clientPaymentId (защита от двойного POST).
        const ins = await client.query(
          `INSERT INTO supplier_order_payments
             (order_id, amount, paid_at, doc_number, comment, client_payment_id, file_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (order_id, client_payment_id) WHERE client_payment_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [order.id, body.amount, body.paidAt ?? null, body.docNumber ?? null, body.comment ?? null,
           body.clientPaymentId ?? null, body.fileId ?? null, user.id],
        );
        if (ins.rows[0]) {
          await appendRequestAudit(client, {
            requestId: request.params.id, action: 'payment_added', userId: user.id,
            changes: { amount: body.amount },
          });
        }
        const status = await recalcRequestStatus(client, request.params.id, user.id);
        await client.query('COMMIT');
        return { data: { status, deduped: !ins.rows[0] } };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // ============================================================
  // POST /:id/revision — на доработку (internal; только из in_work)
  // ============================================================
  fastify.post<{ Params: { id: string } }>(
    '/:id/revision',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const user = request.currentUser;
      const body = requestRevisionSchema.parse(request.body);
      const res = await loadScoped(request.params.id, user);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      // own_supplier можно вернуть на доработку из in_work или из «Оформление РП» (до отправки РП);
      // прочие маршруты — только из in_work (до выбора поставщика).
      const canRevise = mr.request_type === 'own_supplier'
        ? mr.status === 'in_work' || mr.status === 'rp_forming'
        : mr.status === 'in_work';
      if (!canRevise) {
        return reply.status(409).send({ error: 'Заявку сейчас нельзя вернуть на доработку' });
      }
      // И3: доработка удаляет и пересоздаёт позиции — запрещаем, пока они заняты активным лотом.
      if (await hasActiveAllocations(fastify.pool, mr.id)) {
        return reply.status(409).send({ error: 'Позиции заявки включены в закупочный лот — доработка недоступна' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== mr.row_version) {
        return reply.status(409).send({ error: 'Заявка изменена, обновите страницу', rowVersion: mr.row_version });
      }

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO material_request_revisions (request_id, reason, prev_status, requested_by)
           VALUES ($1,$2,$3,$4)`,
          [mr.id, body.comment, mr.status, user.id],
        );
        await client.query(
          `UPDATE material_requests SET status='revision', status_changed_at=now(),
                  status_changed_by=$2, row_version=row_version+1 WHERE id=$1`,
          [mr.id, user.id],
        );
        await appendRequestAudit(client, {
          requestId: mr.id, action: 'revision_requested', userId: user.id,
          changes: { comment: body.comment }, estimateId: mr.estimate_id, projectId: mr.project_id,
        });
        await client.query('COMMIT');
        return { data: { id: mr.id, status: 'revision' } };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // ============================================================
  // POST /:id/revision-complete — завершение доработки (владелец-подрядчик)
  // ============================================================
  fastify.post<{ Params: { id: string } }>(
    '/:id/revision-complete',
    { preHandler: [requireRole('contractor')] },
    async (request, reply) => {
      const user = request.currentUser;
      const body = completeRevisionSchema.parse(request.body);
      const res = await loadScoped(request.params.id, user);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      if (mr.status !== 'revision') return reply.status(409).send({ error: 'Заявка не на доработке' });
      // И3: пересборка позиций осиротила бы закупочные лоты — блокируем при активных аллокациях.
      if (body.lines && (await hasActiveAllocations(fastify.pool, mr.id))) {
        return reply.status(409).send({ error: 'Позиции заявки включены в закупочный лот — правка недоступна' });
      }

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');

        // Правка позиций (опционально): пересобрать по видимым материалам.
        if (body.lines && mr.estimate_id) {
          const visible = await visibleMaterialKeys(client, mr.estimate_id, user.orgId!);
          const lines = body.lines.filter((l) => l.quantity > 0 && visible.has(lineKey(l.costTypeId, l.aggKey)));
          if (lines.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(400).send({ error: 'Нет допустимых строк заявки' });
          }
          await client.query('DELETE FROM material_request_items WHERE request_id = $1', [mr.id]);
          for (const l of lines) {
            await client.query(
              `INSERT INTO material_request_items
                 (request_id, cost_type_id, agg_key, material_id, material_name, unit, quantity)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [mr.id, l.costTypeId, l.aggKey, l.materialId, l.name, l.unit, l.quantity],
            );
          }
        }

        // Завершить последнюю открытую доработку и восстановить статус.
        const { rows: revRows } = await client.query(
          `UPDATE material_request_revisions SET completed_by=$2, completed_at=now(), response=$3
            WHERE id = (SELECT id FROM material_request_revisions
                         WHERE request_id=$1 AND completed_at IS NULL
                         ORDER BY requested_at DESC LIMIT 1)
          RETURNING prev_status`,
          [mr.id, user.id, body.comment ?? null],
        );
        const prevStatus = revRows[0]?.prev_status ?? 'in_work';
        await client.query(
          `UPDATE material_requests SET status=$2, status_changed_at=now(),
                  status_changed_by=$3, row_version=row_version+1 WHERE id=$1`,
          [mr.id, prevStatus, user.id],
        );
        await appendRequestAudit(client, {
          requestId: mr.id, action: 'revision_completed', userId: user.id,
          changes: { to: prevStatus }, estimateId: mr.estimate_id, projectId: mr.project_id,
        });
        const status = await recalcRequestStatus(client, mr.id, user.id);
        await client.query('COMMIT');
        return { data: { id: mr.id, status } };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // ============================================================
  // POST /:id/files — загрузка документа (владелец-подрядчик или internal), потоковая
  // ============================================================
  fastify.post<{ Params: { id: string }; Querystring: { docType?: string } }>(
    '/:id/files',
    async (request, reply) => {
      const user = request.currentUser;
      const res = await loadScoped(request.params.id, user);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      // Подрядчик добавляет документы только до отправки РП (после — исходящий пакет зафиксирован).
      if (isContractor(user) && !['in_work', 'rp_forming', 'revision'].includes(res.row.status)) {
        return reply.status(409).send({ error: 'Документы можно добавлять до отправки РП' });
      }
      if (!fastify.storage) return reply.status(503).send({ error: 'Хранилище файлов не настроено' });
      const { docType } = requestFileMetaSchema.parse({ docType: request.query.docType });

      const file = await request.file({ limits: { fileSize: FILE_LIMIT } });
      if (!file) return reply.status(400).send({ error: 'Файл не загружен' });

      try {
        const meta = await guardedStreamUpload(
          fastify.storage, file.file, file.filename, `material-requests/${res.row.id}`,
        );
        if (file.file.truncated) {
          await fastify.storage.deleteObject(meta.key);
          return reply.status(400).send({ error: 'Файл больше 50 МБ' });
        }
        const { rows } = await fastify.pool.query(
          `INSERT INTO material_request_files
             (request_id, doc_type, file_name, file_key, file_size, mime_type, checksum, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [res.row.id, docType, meta.safeName, meta.key, meta.size, meta.mime, meta.checksum, user.id],
        );
        await appendRequestAudit(fastify.pool, {
          requestId: res.row.id, action: 'file_added', userId: user.id,
          changes: { docType, fileName: meta.safeName },
        });
        return reply.status(201).send({ data: { id: rows[0].id, fileName: meta.safeName, docType } });
      } catch (e) {
        if (e instanceof FileGuardError) return reply.status(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // GET /:id/file/:fileId — download-proxy (S3-ключ наружу не отдаём).
  fastify.get<{ Params: { id: string; fileId: string } }>(
    '/:id/file/:fileId',
    async (request, reply) => {
      const user = request.currentUser;
      const contractorScope = isContractor(user);
      const params: unknown[] = [request.params.fileId, request.params.id];
      let ownerFilter = '';
      if (contractorScope) {
        if (!user.orgId) return reply.status(403).send({ error: 'Нет доступа' });
        params.push(user.orgId);
        ownerFilter = 'AND mr.contractor_id = $3';
      }
      const { rows } = await fastify.pool.query(
        `SELECT f.file_key, f.file_name, f.mime_type
           FROM material_request_files f
           JOIN material_requests mr ON mr.id = f.request_id
          WHERE f.id = $1 AND f.request_id = $2 ${ownerFilter}`,
        params,
      );
      const f = rows[0];
      if (!f || !fastify.storage) return reply.status(404).send({ error: 'Файл не найден' });
      const obj = await fastify.storage.getObject(f.file_key);
      reply.type(f.mime_type || 'application/octet-stream');
      reply.header('X-Content-Type-Options', 'nosniff');
      // Явный Content-Length: без него ответ идёт chunked и прокси может оборвать тело
      // (файл приходит неполным — «Corrupted zip / не удалось загрузить PDF»).
      if (obj.contentLength != null) reply.header('Content-Length', obj.contentLength);
      reply.header(
        'Content-Disposition',
        `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
      );
      return reply.send(obj.body);
    },
  );

  // DELETE /:id/files/:fileId — удаление документа (владелец при in_work/revision; internal — всегда).
  fastify.delete<{ Params: { id: string; fileId: string } }>(
    '/:id/files/:fileId',
    async (request, reply) => {
      const user = request.currentUser;
      const res = await loadScoped(request.params.id, user);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      if (isContractor(user) && !['in_work', 'rp_forming', 'revision'].includes(mr.status)) {
        return reply.status(409).send({ error: 'Файлы можно менять только до отправки РП' });
      }
      const { rows } = await fastify.pool.query(
        `DELETE FROM material_request_files
          WHERE id = $1 AND request_id = $2 AND NOT superseded RETURNING file_key`,
        [request.params.fileId, mr.id],
      );
      if (rows[0] && fastify.storage) await fastify.storage.deleteObject(rows[0].file_key);
      await appendRequestAudit(fastify.pool, {
        requestId: mr.id, action: 'file_removed', userId: user.id,
      });
      return { data: { ok: true } };
    },
  );

  // PATCH /:id/files/:fileId/rejection — вычеркнуть/восстановить документ («неактуальный» файл).
  //   Снабжение и подрядчик, own_supplier, до отправки РП. Вычеркнутый файл перестаёт быть действующим.
  fastify.patch<{ Params: { id: string; fileId: string } }>(
    '/:id/files/:fileId/rejection',
    async (request, reply) => {
      const user = request.currentUser;
      const body = setFileRejectionSchema.parse(request.body);
      const res = await loadScoped(request.params.id, user);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      if (mr.request_type !== 'own_supplier') {
        return reply.status(400).send({ error: 'Вычёркивание доступно только для заявки «Оплата по РП»' });
      }
      if (!['in_work', 'rp_forming', 'revision'].includes(mr.status)) {
        return reply.status(409).send({ error: 'Документы можно менять только до отправки РП' });
      }
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // is_rejected <> $3 — повтор того же значения не создаёт новый аудит (идемпотентно).
        const upd = await client.query(
          `UPDATE material_request_files
              SET is_rejected = $3,
                  rejected_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END,
                  rejected_at = CASE WHEN $3 THEN now() ELSE NULL END
            WHERE id = $1 AND request_id = $2 AND NOT superseded AND is_rejected <> $3
            RETURNING id`,
          [request.params.fileId, mr.id, body.isRejected, user.id],
        );
        if (upd.rowCount === 0) {
          const exists = await client.query(
            `SELECT 1 FROM material_request_files WHERE id = $1 AND request_id = $2 AND NOT superseded`,
            [request.params.fileId, mr.id],
          );
          await client.query('COMMIT');
          if (!exists.rows[0]) return reply.status(404).send({ error: 'Файл не найден' });
          return { data: { ok: true, isRejected: body.isRejected } };
        }
        await appendRequestAudit(client, {
          requestId: mr.id, action: body.isRejected ? 'file_rejected' : 'file_restored', userId: user.id,
          estimateId: mr.estimate_id, projectId: mr.project_id,
        });
        await client.query('COMMIT');
        return { data: { ok: true, isRejected: body.isRejected } };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // ============================================================
  // POST /:id/export — выгрузка заявки в Excel (пакет для поставщика)
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/export', async (request, reply) => {
    const res = await loadScoped(request.params.id, request.currentUser);
    if (!res.ok) return reply.status(res.code).send({ error: res.msg });
    try {
      const { buffer, fileName } = await exportMaterialRequestXlsx(fastify.pool, request.params.id);
      reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header(
        'Content-Disposition',
        `attachment; filename="request.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(buffer);
    } catch (e) {
      if (e instanceof MaterialRequestExportError) return reply.status(e.status).send({ error: e.message });
      throw e;
    }
  });

  // ============================================================
  // POST /:id/rp-application — «Оформить РП» (contractor): реквизиты формы → rp_forming
  // ============================================================
  fastify.post<{ Params: { id: string } }>(
    '/:id/rp-application',
    { preHandler: [requireRole('contractor')] },
    async (request, reply) => {
      const user = request.currentUser;
      const body = rpApplicationSchema.parse(request.body);
      const res = await loadScoped(request.params.id, user);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      if (mr.request_type !== 'own_supplier') {
        return reply.status(400).send({ error: 'Оформление РП доступно только для заявки «Оплата по РП»' });
      }
      if (!['in_work', 'rp_forming', 'revision'].includes(mr.status)) {
        return reply.status(409).send({ error: 'Заявку сейчас нельзя оформить' });
      }
      // Поставщик — из справочника организаций; имя/ИНН берём на сервере (клиент их не задаёт).
      const supRes = await fastify.pool.query(
        `SELECT name, inn FROM organizations WHERE id = $1 AND type = 'supplier' AND is_active`,
        [body.supplierId],
      );
      const sup = supRes.rows[0];
      if (!sup) return reply.status(400).send({ error: 'Поставщик не найден' });
      // Счёт обязателен до перевода в «Оформление РП» (действующий = NOT superseded AND NOT is_rejected).
      const inv = await fastify.pool.query(
        `SELECT 1 FROM material_request_files
          WHERE request_id = $1 AND doc_type = 'invoice' AND NOT superseded AND NOT is_rejected LIMIT 1`,
        [mr.id],
      );
      if (!inv.rows[0]) return reply.status(400).send({ error: 'Приложите счёт (тип «Счёт»)' });

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const ok = await atomicSetStatus(client, mr.id, body.expectedVersion, 'rp_forming', user.id);
        if (!ok) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Заявка изменена, обновите страницу', rowVersion: mr.row_version });
        }
        await client.query(
          `INSERT INTO supplier_orders
             (request_id, kind, supplier_id, supplier_name, supplier_inn, amount,
              delivery_days, delivery_days_type, shipping_conditions, rp_comment, created_by)
           VALUES ($1,'direct',$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (request_id) WHERE kind = 'direct' AND request_id IS NOT NULL
           DO UPDATE SET supplier_id = EXCLUDED.supplier_id, supplier_name = EXCLUDED.supplier_name,
                         supplier_inn = EXCLUDED.supplier_inn, amount = EXCLUDED.amount,
                         delivery_days = EXCLUDED.delivery_days, delivery_days_type = EXCLUDED.delivery_days_type,
                         shipping_conditions = EXCLUDED.shipping_conditions, rp_comment = EXCLUDED.rp_comment,
                         updated_at = now()`,
          [mr.id, body.supplierId, sup.name, sup.inn, body.invoiceAmount,
           body.deliveryDays, body.deliveryDaysType, body.shippingConditions, body.comment ?? null, user.id],
        );
        // Пришли из доработки — закрыть открытую доработку (единое «Исправить и отправить»).
        if (mr.status === 'revision') {
          await client.query(
            `UPDATE material_request_revisions SET completed_by=$2, completed_at=now(), response=$3
              WHERE id = (SELECT id FROM material_request_revisions
                           WHERE request_id=$1 AND completed_at IS NULL
                           ORDER BY requested_at DESC LIMIT 1)`,
            [mr.id, user.id, body.comment ?? null],
          );
        }
        await appendRequestAudit(client, {
          requestId: mr.id, action: 'rp_application_submitted', userId: user.id,
          changes: { supplier: sup.name, amount: body.invoiceAmount },
          estimateId: mr.estimate_id, projectId: mr.project_id,
        });
        await client.query('COMMIT');
        return { data: { id: mr.id, status: 'rp_forming' } };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // ============================================================
  // PATCH /:id/order — правка реквизитов оформленной заявки (own_supplier, rp_forming), без смены статуса.
  //   Доступ: владелец-подрядчик или internal. При смене поставщика/суммы обязателен новый счёт —
  //   прежние действующие счета вычёркиваются (финансовая целостность письма РП).
  // ============================================================
  fastify.patch<{ Params: { id: string } }>('/:id/order', async (request, reply) => {
    const user = request.currentUser;
    const body = orderEditSchema.parse(request.body);
    const res = await loadScoped(request.params.id, user);
    if (!res.ok) return reply.status(res.code).send({ error: res.msg });
    const mr = res.row;
    if (mr.request_type !== 'own_supplier') {
      return reply.status(400).send({ error: 'Правка реквизитов доступна только для заявки «Оплата по РП»' });
    }
    if (mr.status !== 'rp_forming') {
      return reply.status(409).send({ error: 'Реквизиты можно менять только на этапе «Оформление РП»' });
    }
    const ordRes = await fastify.pool.query(
      `SELECT supplier_id, supplier_name, supplier_inn, amount
         FROM supplier_orders WHERE request_id = $1 AND kind = 'direct' LIMIT 1`,
      [mr.id],
    );
    const cur = ordRes.rows[0];
    if (!cur) return reply.status(409).send({ error: 'Заказ ещё не оформлен' });

    const supplierChanged = body.supplierId !== cur.supplier_id;
    const amountChanged = Number(body.invoiceAmount) !== Number(cur.amount);
    // Поставщика из справочника берём для имени/ИНН; неизменённого деактивированного — разрешаем сохранить.
    const supRes = await fastify.pool.query(
      `SELECT name, inn FROM organizations WHERE id = $1 AND type = 'supplier' AND is_active`,
      [body.supplierId],
    );
    const sup = supRes.rows[0];
    if (supplierChanged && !sup) return reply.status(400).send({ error: 'Поставщик не найден' });
    const supName = sup ? sup.name : cur.supplier_name;
    const supInn = sup ? sup.inn : cur.supplier_inn;

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      // Optimistic lock: атомарно бампаем версию (без смены статуса) — конкурентная правка/отправка получит 409.
      const cas = await client.query(
        `UPDATE material_requests SET row_version = row_version + 1 WHERE id = $1 AND row_version = $2`,
        [mr.id, body.expectedVersion],
      );
      if (cas.rowCount !== 1) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заявка изменена, обновите страницу', rowVersion: mr.row_version });
      }
      // При смене поставщика/суммы прежний счёт неактуален — обязателен новый, старые вычёркиваем.
      if (supplierChanged || amountChanged) {
        if (!body.replacementInvoiceFileId) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'При смене поставщика или суммы приложите новый счёт' });
        }
        const nf = await client.query(
          `SELECT id FROM material_request_files
            WHERE id = $1 AND request_id = $2 AND doc_type = 'invoice' AND NOT superseded AND NOT is_rejected`,
          [body.replacementInvoiceFileId, mr.id],
        );
        if (!nf.rows[0]) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Новый счёт не найден среди документов заявки' });
        }
        await client.query(
          `UPDATE material_request_files
              SET is_rejected = true, rejected_by = $2, rejected_at = now()
            WHERE request_id = $1 AND doc_type = 'invoice' AND NOT superseded AND NOT is_rejected AND id <> $3`,
          [mr.id, user.id, body.replacementInvoiceFileId],
        );
      }
      await client.query(
        `UPDATE supplier_orders
            SET supplier_id = $2, supplier_name = $3, supplier_inn = $4, amount = $5,
                delivery_days = $6, delivery_days_type = $7, shipping_conditions = $8, rp_comment = $9,
                updated_at = now()
          WHERE request_id = $1 AND kind = 'direct'`,
        [mr.id, supplierChanged ? body.supplierId : cur.supplier_id, supName, supInn, body.invoiceAmount,
         body.deliveryDays, body.deliveryDaysType, body.shippingConditions, body.comment ?? null],
      );
      await appendRequestAudit(client, {
        requestId: mr.id, action: 'order_updated', userId: user.id,
        changes: {
          before: { supplier: cur.supplier_name, amount: cur.amount },
          after: { supplier: supName, amount: body.invoiceAmount },
        },
        estimateId: mr.estimate_id, projectId: mr.project_id,
      });
      await client.query('COMMIT');
      return { data: { id: mr.id, rowVersion: body.expectedVersion + 1 } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/rp-send — «Отправить РП» (internal): создать письмо в PayHub → rp_sent
  // ============================================================
  fastify.post<{ Params: { id: string } }>(
    '/:id/rp-send',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const user = request.currentUser;
      const body = rpSendSchema.parse(request.body);
      const res = await loadScoped(request.params.id, user);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      if (mr.request_type !== 'own_supplier') {
        return reply.status(400).send({ error: 'Отправка РП доступна только для заявки «Оплата по РП»' });
      }
      // Идемпотентность: уже отправлено/оплачено.
      if (mr.status === 'rp_sent' || mr.status === 'rp_paid') {
        return reply.status(200).send({ data: { id: mr.id, status: mr.status, deduped: true } });
      }
      if (mr.status !== 'rp_forming') {
        return reply.status(409).send({ error: 'Отправить РП можно из статуса «Оформление РП»' });
      }
      if (body.expectedVersion !== mr.row_version) {
        return reply.status(409).send({ error: 'Заявка изменена, обновите страницу', rowVersion: mr.row_version });
      }
      const orderRes = await fastify.pool.query(
        `SELECT amount, supplier_name FROM supplier_orders WHERE request_id = $1 AND kind = 'direct' LIMIT 1`,
        [mr.id],
      );
      const order = orderRes.rows[0];
      if (!order) return reply.status(400).send({ error: 'Не оформлен заказ (нет поставщика и суммы)' });

      // Счёт мог быть вычеркнут после оформления — действующий счёт обязателен для отправки.
      const invSend = await fastify.pool.query(
        `SELECT 1 FROM material_request_files
          WHERE request_id = $1 AND doc_type = 'invoice' AND NOT superseded AND NOT is_rejected LIMIT 1`,
        [mr.id],
      );
      if (!invSend.rows[0]) return reply.status(400).send({ error: 'Нет действующего счёта — приложите счёт перед отправкой РП' });

      const payhub = getPayHubClient();
      if (!payhub) return reply.status(400).send({ error: 'Интеграция PayHub не настроена' });

      // Резолв маппинга (проект/получатель/отправитель); нехватка → 400 (статус не меняем).
      let cfg;
      try {
        cfg = await resolveLetterConfig(fastify.pool, mr.id);
      } catch (e) {
        if (e instanceof PayHubWaitingConfigError) return reply.status(400).send({ error: e.message });
        throw e;
      }

      // Значения письма (снимок сохраняется в rp_letters для реестра/правки).
      const subjectVal = body.subject ?? 'РП';
      const contentVal = body.content ?? buildLetterContent({
        amount: order.amount, supplierName: order.supplier_name, description: mr.project_name,
      });
      const responsibleVal = body.responsibleName ?? user.fullName ?? null;

      // Синхронное создание письма PayHub (получить рег.номер) — вне транзакции БД.
      let ensured;
      try {
        ensured = await ensureRpLetter(payhub, {
          externalRef: rpExternalRef(mr.id),
          projectId: cfg.projectId,
          senderId: cfg.senderId,
          recipientId: cfg.recipientId,
          letterDate: body.rpDate,
          subject: subjectVal,
          content: contentVal,
          responsibleName: responsibleVal,
        });
      } catch (e) {
        if (e instanceof PayHubApiError) {
          return reply.status(e.retryable ? 503 : 502).send({ error: `PayHub: ${e.message}` });
        }
        throw e;
      }

      // Снимок имени получателя PayHub для реестра/формы (best-effort; при недоступности — null).
      const recipient = await resolveRecipient(payhub, cfg.recipientId);

      // Исходящий набор вложений письма (счёт/КП/спецификация/договор/прочее; платёжки НЕ входят;
      // вычеркнутые документы не отправляются).
      const outFiles = await fastify.pool.query(
        `SELECT id FROM material_request_files
          WHERE request_id = $1 AND NOT superseded AND NOT is_rejected AND doc_type <> 'payment'`,
        [mr.id],
      );
      const hasFiles = outFiles.rows.length > 0;

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const ok = await atomicSetStatus(client, mr.id, body.expectedVersion, 'rp_sent', user.id);
        if (!ok) {
          await client.query('ROLLBACK');
          // Письмо в PayHub уже создано (external_ref идемпотентен) — при повторе усыновится.
          return reply.status(409).send({ error: 'Заявка изменена, обновите страницу', rowVersion: mr.row_version });
        }
        await client.query(
          `UPDATE supplier_orders SET rp_number = $2, rp_date = $3, updated_at = now()
            WHERE request_id = $1 AND kind = 'direct'`,
          [mr.id, ensured.regNumber, body.rpDate],
        );
        const rlRes = await client.query(
          `INSERT INTO rp_letters
             (request_id, external_ref, payhub_letter_id, payhub_reg_number, payhub_url,
              sent_at, sync_status, created_by,
              subject, content, responsible_name, letter_date, invoice_number, payhub_qr_svg, recipient_name)
           VALUES ($1,$2,$3,$4,$5, now(), $6, $7, $8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (external_ref) DO UPDATE SET
             payhub_letter_id = EXCLUDED.payhub_letter_id, payhub_reg_number = EXCLUDED.payhub_reg_number,
             payhub_url = EXCLUDED.payhub_url,
             sent_at = COALESCE(rp_letters.sent_at, EXCLUDED.sent_at),
             sync_status = EXCLUDED.sync_status, last_error = NULL,
             subject = EXCLUDED.subject, content = EXCLUDED.content,
             responsible_name = EXCLUDED.responsible_name, letter_date = EXCLUDED.letter_date,
             invoice_number = EXCLUDED.invoice_number, payhub_qr_svg = EXCLUDED.payhub_qr_svg,
             recipient_name = EXCLUDED.recipient_name
           RETURNING id`,
          [mr.id, rpExternalRef(mr.id), ensured.letterId, ensured.regNumber, ensured.url,
           hasFiles ? 'pending' : 'synced', user.id,
           subjectVal, contentVal, responsibleVal, body.rpDate, body.invoiceNumber ?? null,
           ensured.qr, recipient?.name ?? null],
        );
        const rpLetterId = rlRes.rows[0].id as string;
        for (const f of outFiles.rows) {
          await client.query(
            `INSERT INTO rp_letter_attachments (rp_letter_id, file_id)
             VALUES ($1,$2) ON CONFLICT (rp_letter_id, file_id) DO NOTHING`,
            [rpLetterId, f.id],
          );
        }
        if (hasFiles) {
          await client.query(
            `INSERT INTO integration_outbox
               (aggregate_type, aggregate_id, command_type, external_ref, payload, payload_hash, status, next_attempt_at)
             VALUES ('rp_letter', $1, 'rp_letter.sync', $2, $3::jsonb, $4, 'queued', now())`,
            [mr.id, rpExternalRef(mr.id), JSON.stringify({ rpLetterId }), canonicalHash({ rpLetterId })],
          );
        }
        await appendRequestAudit(client, {
          requestId: mr.id, action: 'rp_sent', userId: user.id,
          changes: { regNumber: ensured.regNumber },
          estimateId: mr.estimate_id, projectId: mr.project_id,
        });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      if (hasFiles) fastify.outbox.kick();
      return { data: { id: mr.id, status: 'rp_sent', regNumber: ensured.regNumber, url: ensured.url, qr: ensured.qr } };
    },
  );

  // ============================================================
  // POST /:id/rp-resync — ручная повторная синхронизация письма/вложений (internal)
  // ============================================================
  fastify.post<{ Params: { id: string } }>(
    '/:id/rp-resync',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const res = await loadScoped(request.params.id, request.currentUser);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      const rl = await fastify.pool.query(
        `SELECT id FROM rp_letters WHERE request_id = $1 AND sync_status <> 'annulled' LIMIT 1`,
        [mr.id],
      );
      if (!rl.rows[0]) return reply.status(404).send({ error: 'Письмо РП не найдено' });
      const rpLetterId = rl.rows[0].id as string;
      await fastify.pool.query(
        `INSERT INTO integration_outbox
           (aggregate_type, aggregate_id, command_type, external_ref, payload, payload_hash, status, next_attempt_at)
         VALUES ('rp_letter', $1, 'rp_letter.sync', $2, $3::jsonb, $4, 'queued', now())`,
        [mr.id, rpExternalRef(mr.id), JSON.stringify({ rpLetterId }), canonicalHash({ rpLetterId, ts: 'resync' })],
      );
      await fastify.pool.query(
        `UPDATE rp_letters SET sync_status='pending', last_error=NULL WHERE id=$1 AND sync_status='failed'`,
        [rpLetterId],
      );
      fastify.outbox.kick();
      return { data: { ok: true } };
    },
  );

  // ============================================================
  // GET /:id/rp-config — данные для формы «Отправить РП» (проект/отправитель/получатель + дефолты)
  // ============================================================
  fastify.get<{ Params: { id: string } }>(
    '/:id/rp-config',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const res = await loadScoped(request.params.id, request.currentUser);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;

      const { rows: prj } = await fastify.pool.query(
        `SELECT p.code, p.name, p.payhub_project_id, p.payhub_contractor_id
           FROM projects p WHERE p.id = $1`,
        [mr.project_id],
      );
      const project = prj[0] ?? null;
      const { rows: ord } = await fastify.pool.query(
        `SELECT amount, supplier_name FROM supplier_orders WHERE request_id = $1 AND kind = 'direct' LIMIT 1`,
        [mr.id],
      );
      const order = ord[0] ?? null;

      const sender = await getRpSender(fastify.pool);
      const mapped = !!(project && project.payhub_project_id != null && project.payhub_contractor_id != null);

      let recipient: { name: string; inn: string | null } | null = null;
      const payhub = getPayHubClient();
      if (payhub && project?.payhub_contractor_id != null) {
        recipient = await resolveRecipient(payhub, Number(project.payhub_contractor_id));
      }

      const defaultContent = order
        ? buildLetterContent({ amount: order.amount, supplierName: order.supplier_name, description: mr.project_name })
        : '';

      return {
        data: {
          project: project ? { code: project.code ?? null, name: project.name ?? null } : null,
          sender: sender ? { name: sender.name, inn: sender.inn } : null,
          recipient,
          mapped,
          defaultSubject: 'РП',
          defaultContent,
          responsibleName: request.currentUser.fullName ?? null,
        },
      };
    },
  );

  // ============================================================
  // POST /:id/rp-annul — аннулировать РП (чистый откат): удалить письмо в PayHub, вернуть заявку
  //   в «Оформление РП». Только полностью неоплаченную (сумма незасторнированных оплат = 0).
  // ============================================================
  fastify.post<{ Params: { id: string } }>(
    '/:id/rp-annul',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const user = request.currentUser;
      const res = await loadScoped(request.params.id, user);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      if (mr.request_type !== 'own_supplier') {
        return reply.status(400).send({ error: 'Аннулирование доступно только для заявки «Оплата по РП»' });
      }
      if (mr.status !== 'rp_sent') {
        return reply.status(409).send({ error: 'Аннулировать можно только отправленную неоплаченную РП' });
      }
      // Полностью неоплаченная: сумма незасторнированных оплат = 0.
      const { rows: payRows } = await fastify.pool.query(
        `SELECT COALESCE(SUM(sop.amount), 0) AS paid
           FROM supplier_order_payments sop
           JOIN supplier_orders so ON so.id = sop.order_id AND so.kind = 'direct'
          WHERE so.request_id = $1 AND NOT sop.reversed`,
        [mr.id],
      );
      if (Number(payRows[0]?.paid ?? 0) > 0) {
        return reply.status(409).send({ error: 'Аннулировать можно только полностью неоплаченную РП' });
      }
      const { rows: rlRows } = await fastify.pool.query(
        `SELECT id, payhub_letter_id FROM rp_letters WHERE request_id = $1 AND sync_status <> 'annulled' LIMIT 1`,
        [mr.id],
      );
      const rl = rlRows[0];
      if (!rl) return reply.status(404).send({ error: 'Письмо РП не найдено' });

      // Инвариант: сначала строго удаляем письмо в PayHub, только потом меняем БД.
      if (rl.payhub_letter_id) {
        const payhub = getPayHubClient();
        if (!payhub) return reply.status(400).send({ error: 'Интеграция PayHub не настроена' });
        try {
          await payhub.deleteLetter(rl.payhub_letter_id);
        } catch (e) {
          if (e instanceof PayHubApiError) {
            // 404 — письмо уже удалено, продолжаем; прочие ошибки — не трогаем БД.
            if (e.httpStatus !== 404) {
              return reply.status(e.retryable ? 503 : 502).send({ error: `Не удалось удалить письмо в PayHub: ${e.message}` });
            }
          } else {
            throw e;
          }
        }
      }

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // Гасим незавершённые команды синхронизации письма (воркер их больше не подхватит).
        await client.query(
          `UPDATE integration_outbox SET status = 'dead_letter', updated_at = now()
            WHERE aggregate_type = 'rp_letter' AND aggregate_id = $1
              AND command_type = 'rp_letter.sync' AND status IN ('queued', 'retry_wait', 'waiting_config')`,
          [mr.id],
        );
        // Вложения удаляем — переотправка наберёт их заново (иначе payhub_attachment_id заблокирует догрузку).
        await client.query(`DELETE FROM rp_letter_attachments WHERE rp_letter_id = $1`, [rl.id]);
        // Письмо → annulled, PayHub-поля и QR обнуляем.
        await client.query(
          `UPDATE rp_letters SET sync_status = 'annulled', payhub_letter_id = NULL,
             payhub_reg_number = NULL, payhub_url = NULL, payhub_qr_svg = NULL,
             sent_date = NULL, last_error = NULL, updated_at = now()
           WHERE id = $1`,
          [rl.id],
        );
        // Заявка возвращается в «Оформление РП» (можно переотправить).
        const ok = await atomicSetStatus(client, mr.id, mr.row_version, 'rp_forming', user.id);
        if (!ok) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Заявка изменена, обновите страницу', rowVersion: mr.row_version });
        }
        await client.query(
          `UPDATE supplier_orders SET rp_number = NULL, rp_date = NULL, updated_at = now()
            WHERE request_id = $1 AND kind = 'direct'`,
          [mr.id],
        );
        await appendRequestAudit(client, {
          requestId: mr.id, action: 'rp_annulled', userId: user.id,
          estimateId: mr.estimate_id, projectId: mr.project_id,
        });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return { data: { id: mr.id, status: 'rp_forming' } };
    },
  );

  // ============================================================
  // PATCH /:id/rp-letter-text — правка текста письма из реестра (PayHub-first)
  // ============================================================
  fastify.patch<{ Params: { id: string } }>(
    '/:id/rp-letter-text',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const body = rpLetterTextSchema.parse(request.body);
      const res = await loadScoped(request.params.id, request.currentUser);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      const { rows } = await fastify.pool.query(
        `SELECT id, payhub_letter_id FROM rp_letters
          WHERE request_id = $1 AND sync_status <> 'annulled' LIMIT 1`,
        [mr.id],
      );
      const rl = rows[0];
      if (!rl) return reply.status(404).send({ error: 'Письмо РП не найдено' });

      // PayHub-first: если письмо уже создано — сначала правим его; БД пишем только при успехе.
      if (rl.payhub_letter_id) {
        const payhub = getPayHubClient();
        if (!payhub) return reply.status(400).send({ error: 'Интеграция PayHub не настроена' });
        try {
          await payhub.updateLetter(rl.payhub_letter_id, {
            subject: body.subject,
            content: body.content ?? '',
            responsible_person_name: body.responsibleName ?? undefined,
            letter_date: body.letterDate ?? undefined,
          });
        } catch (e) {
          if (e instanceof PayHubApiError) {
            return reply.status(e.retryable ? 503 : 502).send({ error: `Не удалось обновить письмо в PayHub: ${e.message}` });
          }
          throw e;
        }
      }
      await fastify.pool.query(
        `UPDATE rp_letters SET subject = $2, content = $3, responsible_name = $4,
           letter_date = COALESCE($5::date, letter_date), updated_at = now()
         WHERE id = $1`,
        [rl.id, body.subject, body.content ?? null, body.responsibleName ?? null, body.letterDate ?? null],
      );
      return { data: { ok: true } };
    },
  );

  // ============================================================
  // PATCH /:id/rp-sent-date — ручная дата отправки письма (inline в реестре)
  // ============================================================
  fastify.patch<{ Params: { id: string } }>(
    '/:id/rp-sent-date',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const body = rpSentDateSchema.parse(request.body);
      const res = await loadScoped(request.params.id, request.currentUser);
      if (!res.ok) return reply.status(res.code).send({ error: res.msg });
      const mr = res.row;
      const { rowCount } = await fastify.pool.query(
        `UPDATE rp_letters SET sent_date = $2, updated_at = now()
          WHERE request_id = $1 AND sync_status <> 'annulled'`,
        [mr.id, body.sentDate],
      );
      if (rowCount === 0) return reply.status(404).send({ error: 'Письмо РП не найдено' });
      return { data: { ok: true } };
    },
  );

  // ============================================================
  // POST /:id/cancel — отмена заявки до отправки РП (владелец-подрядчик или internal)
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const user = request.currentUser;
    const body = cancelRequestSchema.parse(request.body);
    const res = await loadScoped(request.params.id, user);
    if (!res.ok) return reply.status(res.code).send({ error: res.msg });
    const mr = res.row;
    if (['rp_sent', 'rp_paid', 'cancelled', 'delivered'].includes(mr.status)) {
      return reply.status(409).send({ error: 'Заявку уже нельзя отменить' });
    }
    // Подрядчик отменяет заявку «Оплата по РП» только до первой смены статуса (пока «В работе»).
    if (isContractor(user) && !(mr.request_type === 'own_supplier' && mr.status === 'in_work')) {
      return reply.status(409).send({ error: 'Отменить заявку можно только до первой смены статуса' });
    }
    // Материалы в лотах, ушедших в закупку (sourcing/awarded/cancel_pending), освободить отменой
    // заявки нельзя — состав заморожен, снабжение сначала отменяет лот сам.
    if (await hasFrozenAllocations(fastify.pool, mr.id)) {
      return reply.status(409).send({ error: 'Материалы заявки в активной закупке (лот в закупке или присуждён) — сначала отмените лот' });
    }
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      // Освобождаем материалы из формируемых лотов (позиции удаляются, остаток возвращается в свод).
      await releaseFormingAllocations(client, mr.id, user.id);
      const ok = await atomicSetStatus(client, mr.id, body.expectedVersion, 'cancelled', user.id);
      if (!ok) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Заявка изменена, обновите страницу', rowVersion: mr.row_version });
      }
      await appendRequestAudit(client, {
        requestId: mr.id, action: 'cancelled', userId: user.id,
        changes: { reason: body.reason ?? null }, estimateId: mr.estimate_id, projectId: mr.project_id,
      });
      await client.query('COMMIT');
      return { data: { id: mr.id, status: 'cancelled' } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // DELETE /:id — полное удаление заявки администратором (необратимо).
  //   Освобождает позиции из закупочных лотов, удаляет документы из S3, каскадно чистит связи.
  // ============================================================
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const user = request.currentUser;
    const { rows: mrRows } = await fastify.pool.query(
      `SELECT id, estimate_id, project_id FROM material_requests WHERE id = $1`,
      [request.params.id],
    );
    const mr = mrRows[0];
    if (!mr) return reply.status(404).send({ error: 'Заявка не найдена' });

    const fileKeys: string[] = [];
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      // Ключи файлов — удалим объекты из S3 после COMMIT (best-effort).
      const { rows: files } = await client.query(
        `SELECT file_key FROM material_request_files WHERE request_id = $1`,
        [mr.id],
      );
      for (const f of files) if (f.file_key) fileKeys.push(f.file_key as string);

      // Освобождаем материалы из ВСЕХ лотов (админ-оверрайд): иначе request_id→SET NULL оставит
      // осиротевшие позиции, продолжающие резервировать материал.
      const { rows: soi } = await client.query(
        `DELETE FROM supplier_order_items WHERE request_id = $1 RETURNING order_id`,
        [mr.id],
      );
      const orderIds = [...new Set(soi.map((r) => r.order_id as string))];
      for (const orderId of orderIds) {
        const { rows: lotRows } = await client.query(
          `UPDATE supplier_orders SET row_version = row_version + 1, updated_at = now()
            WHERE id = $1 RETURNING project_id`,
          [orderId],
        );
        await appendOrderAudit(client, {
          orderId, action: 'item_removed', userId: user.id,
          changes: { reason: 'request_deleted' }, projectId: lotRows[0]?.project_id ?? null,
        });
      }

      // Журнал (audit_log без FK на заявку — запись переживёт каскадное удаление).
      await appendRequestAudit(client, {
        requestId: mr.id, action: 'deleted', userId: user.id,
        estimateId: mr.estimate_id, projectId: mr.project_id,
      });

      // Каскады подчистят items/revisions/files/comments/read_status/прямые supplier_orders/rp_letters.
      await client.query('DELETE FROM material_requests WHERE id = $1', [mr.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    if (fastify.storage) {
      for (const key of fileKeys) {
        try { await fastify.storage.deleteObject(key); }
        catch (err) { fastify.log.warn({ err, key }, 'request delete: не удалось удалить объект из S3'); }
      }
    }
    return { data: { ok: true } };
  });
}
