import type { FastifyInstance } from 'fastify';
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
} from '@estimat/shared';
import {
  assertContractorEstimateAccess,
  visibleMaterialKeys,
  lineKey,
  appendRequestAudit,
} from '../../lib/material-requests/access.js';
import { recalcRequestStatus } from '../../lib/requests/status-recalc.js';
import { guardedStreamUpload, FileGuardError } from '../../lib/uploads/file-guard.js';
import { exportMaterialRequestXlsx, MaterialRequestExportError } from '../../lib/material-request-export/index.js';

const INTERNAL_ROLES = new Set(['admin', 'engineer', 'manager']);
const FILE_LIMIT = 50 * 1024 * 1024; // 50 МБ на файл (per-route)

const canonicalHash = (obj: unknown): string =>
  createHash('sha256').update(JSON.stringify(obj)).digest('hex');

const requestNumber = (projectCode: string | null, no: number | null): string =>
  `${projectCode ?? 'ЗМ'}-${String(no ?? 0).padStart(2, '0')}`;

export default async function requestRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

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
      type?: string; status?: string; projectId?: string; contractorId?: string;
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
    } else {
      where.push(`mr.request_type <> 'legacy'`); // архив скрыт по умолчанию
    }
    if (q.status) {
      values.push(q.status);
      where.push(`mr.status = $${values.length}`);
    }
    if (q.projectId) {
      values.push(q.projectId);
      where.push(`mr.project_id = $${values.length}`);
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
              so.supplier_name, so.supplier_inn, so.amount AS order_amount, so.rp_number,
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
        `SELECT id, doc_type, file_name, file_size, mime_type, created_at
           FROM material_request_files WHERE request_id = $1 AND NOT superseded
          ORDER BY created_at`,
        [mr.id],
      ),
      fastify.pool.query(
        `SELECT id, supplier_name, supplier_inn, amount, rp_number, rp_date, created_at
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
        `SELECT id, amount, paid_at, doc_number, comment, created_at
           FROM supplier_order_payments WHERE order_id = $1 ORDER BY created_at`,
        [order.rows[0].id],
      );
    }

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
      `SELECT e.project_id, e.name AS estimate_name, p.code AS project_code, p.name AS project_name,
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

      // Прямой заказ при создании — только для прямых маршрутов (РП / собственная закупка).
      // По su10 поставщика выбирает снабжение, поэтому реквизиты из тела игнорируются.
      if (
        body.supplierName && body.resultAmount &&
        (body.requestType === 'own_supplier' || body.requestType === 'own_supply')
      ) {
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
    // По заявкам СУ-10 поставщика выбирает снабжение, а не подрядчик (прямой маршрут — только own_supplier/own_supply).
    if (user.role === 'contractor' && mr.request_type !== 'own_supplier' && mr.request_type !== 'own_supply') {
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
      const orderRes = await fastify.pool.query(
        `SELECT id FROM supplier_orders WHERE request_id = $1 AND kind = 'direct' LIMIT 1`,
        [request.params.id],
      );
      const order = orderRes.rows[0];
      if (!order) return reply.status(400).send({ error: 'Сначала выберите поставщика (заказ отсутствует)' });

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO supplier_order_payments (order_id, amount, paid_at, doc_number, comment, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [order.id, body.amount, body.paidAt ?? null, body.docNumber ?? null, body.comment ?? null, user.id],
        );
        await appendRequestAudit(client, {
          requestId: request.params.id, action: 'payment_added', userId: user.id,
          changes: { amount: body.amount },
        });
        const status = await recalcRequestStatus(client, request.params.id, user.id);
        await client.query('COMMIT');
        return { data: { status } };
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
      if (mr.status !== 'in_work') {
        return reply.status(409).send({ error: 'Доработка возможна только до выбора поставщика' });
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
      if (isContractor(user) && !['in_work', 'revision'].includes(mr.status)) {
        return reply.status(409).send({ error: 'Файлы можно менять только до выбора поставщика' });
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
}
