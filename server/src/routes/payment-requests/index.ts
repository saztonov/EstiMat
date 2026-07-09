import type { FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createPaymentRequestSchema,
  updatePaymentRequestSchema,
} from '@estimat/shared';
import { getRefs, type RefType } from '../../lib/billhub/refs.js';
import { config } from '../../config.js';

// Заявка на оплату (EstiMat) — локальная read-модель + команда в BillHub.
// Поток: create(draft) → upload files → submit (запись команды в integration_outbox в одной
// транзакции, fast-path после COMMIT). Объект/контрагент выводятся из заявки на материалы;
// поставщик/условия — из справочников BillHub. Жизненный цикл приходит из BillHub (см. integration).

// Разрешённые типы файлов счёта + сигнатуры (magic bytes) — финансовые документы, не изображения проекта.
const ALLOWED_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp']);
// MIME выводим на сервере из проверенного расширения — НЕ доверяем клиентскому content-type
// (иначе .pdf-полиглот с content-type text/html → XSS при отдаче). Хранится именно этот безопасный MIME.
const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
};
function sniffOk(buf: Buffer, ext: string): boolean {
  const b = buf;
  const starts = (sig: number[]) => sig.every((x, i) => b[i] === x);
  if (ext === 'pdf') return starts([0x25, 0x50, 0x44, 0x46]); // %PDF
  if (ext === 'png') return starts([0x89, 0x50, 0x4e, 0x47]);
  if (ext === 'jpg' || ext === 'jpeg') return starts([0xff, 0xd8, 0xff]);
  if (ext === 'bmp') return starts([0x42, 0x4d]);
  if (ext === 'tif' || ext === 'tiff') return starts([0x49, 0x49, 0x2a, 0x00]) || starts([0x4d, 0x4d, 0x00, 0x2a]);
  if (ext === 'docx' || ext === 'xlsx') return starts([0x50, 0x4b, 0x03, 0x04]); // zip (OOXML)
  if (ext === 'doc' || ext === 'xls') return starts([0xd0, 0xcf, 0x11, 0xe0]); // OLE2
  return false;
}

const canonicalHash = (obj: unknown): string =>
  createHash('sha256').update(JSON.stringify(obj)).digest('hex');

export default async function paymentRequestRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // Доступ подрядчика к своей заявке на оплату.
  async function loadOwned(id: string, orgId: string) {
    const { rows } = await fastify.pool.query(
      `SELECT * FROM payment_requests WHERE id = $1 AND contractor_id = $2`,
      [id, orgId],
    );
    return rows[0] ?? null;
  }

  // ============================================================
  // Справочники BillHub для формы (прокси + кэш). Site/counterparty НЕ отдаём — выводятся сервером.
  // ============================================================
  fastify.get<{ Params: { type: string } }>('/references/:type', async (request, reply) => {
    const map: Record<string, RefType> = {
      suppliers: 'suppliers',
      shipping: 'shipping',
      'document-types': 'document_types',
    };
    const refType = map[request.params.type];
    if (!refType) return reply.status(404).send({ error: 'Неизвестный справочник' });
    const res = await getRefs(fastify, refType);
    return { data: res.data, meta: { stale: res.stale, configured: res.configured } };
  });

  // ============================================================
  // POST / — создать черновик заявки на оплату на основе заявки на материалы
  // ============================================================
  fastify.post('/', { preHandler: [requireRole('contractor')] }, async (request, reply) => {
    const user = request.currentUser;
    if (!user.orgId) return reply.status(400).send({ error: 'Пользователь не привязан к организации' });
    const body = createPaymentRequestSchema.parse(request.body);

    // Идемпотентность пользовательского POST: тот же create_request_id → существующая заявка.
    const dup = await fastify.pool.query(
      `SELECT id FROM payment_requests WHERE create_request_id = $1 AND contractor_id = $2`,
      [body.createRequestId, user.orgId],
    );
    if (dup.rows[0]) return reply.status(200).send({ data: { id: dup.rows[0].id, deduped: true } });

    // Заявка на материалы: владелец + тип own_supplier.
    const mrRes = await fastify.pool.query(
      `SELECT mr.id, mr.estimate_id, mr.project_id, mr.contractor_id, mr.request_type,
              p.code AS project_code, p.name AS project_name,
              org.name AS contractor_name, org.inn AS contractor_inn
         FROM material_requests mr
         LEFT JOIN projects p        ON p.id = mr.project_id
         LEFT JOIN organizations org ON org.id = mr.contractor_id
        WHERE mr.id = $1`,
      [body.materialRequestId],
    );
    const mr = mrRes.rows[0];
    if (!mr) return reply.status(404).send({ error: 'Заявка на материалы не найдена' });
    if (mr.contractor_id !== user.orgId) return reply.status(403).send({ error: 'Чужая заявка на материалы' });
    if (mr.request_type !== 'own_supplier') {
      return reply.status(400).send({ error: 'Заявка на оплату доступна только для типа «Свой поставщик (РП)»' });
    }

    // 1:1 — одна заявка на материалы → максимум одна заявка на оплату.
    const exists = await fastify.pool.query(
      `SELECT id FROM payment_requests WHERE material_request_id = $1`,
      [body.materialRequestId],
    );
    if (exists.rows[0]) {
      return reply.status(409).send({ error: 'Заявка на оплату по этой заявке уже создана' });
    }

    // Снимок позиций (переживает изменение/удаление сметы).
    const itemsRes = await fastify.pool.query(
      `SELECT mri.material_name AS name, mri.unit, mri.quantity, ct.name AS cost_type_name
         FROM material_request_items mri
         LEFT JOIN cost_types ct ON ct.id = mri.cost_type_id
        WHERE mri.request_id = $1
        ORDER BY ct.name NULLS LAST, mri.material_name`,
      [body.materialRequestId],
    );

    const { rows } = await fastify.pool.query(
      `WITH new_id AS (SELECT gen_random_uuid() AS id)
       INSERT INTO payment_requests (
         id, external_ref, material_request_id, items_snapshot, create_request_id,
         estimate_id, project_id, contractor_id, contractor_name, contractor_inn,
         bh_supplier_id, bh_supplier_name, bh_supplier_inn,
         bh_shipping_condition_id, bh_shipping_condition_value,
         delivery_days, delivery_days_type, invoice_amount, comment, created_by
       )
       SELECT n.id, 'estimat:pr:' || n.id, $1, $2, $3,
              $4, $5, $6, $7, $8,
              $9, $10, $11, $12, $13,
              $14, COALESCE($15, 'working'), $16, $17, $18
         FROM new_id n
       RETURNING id`,
      [
        body.materialRequestId,
        JSON.stringify(itemsRes.rows),
        body.createRequestId,
        mr.estimate_id,
        mr.project_id,
        mr.contractor_id,
        mr.contractor_name,
        mr.contractor_inn,
        body.bhSupplierId ?? null,
        body.bhSupplierName ?? null,
        body.bhSupplierInn ?? null,
        body.bhShippingConditionId ?? null,
        body.bhShippingConditionValue ?? null,
        body.deliveryDays ?? null,
        body.deliveryDaysType ?? null,
        body.invoiceAmount ?? null,
        body.comment ?? null,
        user.id,
      ],
    );
    return reply.status(201).send({ data: { id: rows[0].id } });
  });

  // ============================================================
  // PATCH /:id — редактирование черновика
  // ============================================================
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole('contractor')] },
    async (request, reply) => {
      const user = request.currentUser;
      if (!user.orgId) return reply.status(400).send({ error: 'Нет организации' });
      const pr = await loadOwned(request.params.id, user.orgId);
      if (!pr) return reply.status(404).send({ error: 'Заявка не найдена' });
      if (pr.lifecycle_state !== 'draft') {
        return reply.status(409).send({ error: 'Отправленную заявку редактировать нельзя' });
      }
      const b = updatePaymentRequestSchema.parse(request.body);
      await fastify.pool.query(
        `UPDATE payment_requests SET
           bh_supplier_id = $2, bh_supplier_name = $3, bh_supplier_inn = $4,
           bh_shipping_condition_id = $5, bh_shipping_condition_value = $6,
           delivery_days = $7, delivery_days_type = COALESCE($8, delivery_days_type),
           invoice_amount = $9, comment = $10
         WHERE id = $1`,
        [
          pr.id,
          b.bhSupplierId ?? null, b.bhSupplierName ?? null, b.bhSupplierInn ?? null,
          b.bhShippingConditionId ?? null, b.bhShippingConditionValue ?? null,
          b.deliveryDays ?? null, b.deliveryDaysType ?? null,
          b.invoiceAmount ?? null, b.comment ?? null,
        ],
      );
      return { data: { id: pr.id } };
    },
  );

  // ============================================================
  // POST /:id/files — загрузка счёта (multipart) в приватный S3-prefix
  // ============================================================
  fastify.post<{ Params: { id: string } }>(
    '/:id/files',
    { preHandler: [requireRole('contractor')] },
    async (request, reply) => {
      const user = request.currentUser;
      if (!user.orgId) return reply.status(400).send({ error: 'Нет организации' });
      const pr = await loadOwned(request.params.id, user.orgId);
      if (!pr) return reply.status(404).send({ error: 'Заявка не найдена' });
      if (pr.lifecycle_state !== 'draft') {
        return reply.status(409).send({ error: 'Отправленную заявку изменять нельзя' });
      }
      if (!fastify.storage) return reply.status(503).send({ error: 'Хранилище файлов не настроено' });

      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'Файл не загружен' });
      const ext = (file.filename.split('.').pop() ?? '').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) return reply.status(400).send({ error: 'Недопустимый тип файла' });
      const buffer = await file.toBuffer();
      if (file.file.truncated) return reply.status(400).send({ error: 'Файл больше 10 МБ' });
      if (!sniffOk(buffer, ext)) return reply.status(400).send({ error: 'Содержимое файла не соответствует расширению' });

      const documentTypeId = (request.body as { documentTypeId?: string } | undefined)?.documentTypeId
        ?? (file.fields as Record<string, { value?: string }> | undefined)?.documentTypeId?.value
        ?? null;

      // MIME — только из проверенного расширения, не из клиентского content-type.
      const mime = EXT_TO_MIME[ext] ?? 'application/octet-stream';
      const safeName = file.filename.replace(/[^\w.\-а-яА-ЯёЁ ]+/g, '_').slice(0, 200);
      const key = `payment-requests/${pr.id}/${randomUUID()}_${safeName}`;
      await fastify.storage.putObject(key, buffer, mime);
      const checksum = createHash('sha256').update(buffer).digest('hex');

      const { rows } = await fastify.pool.query(
        `INSERT INTO payment_request_files
           (payment_request_id, bh_document_type_id, file_name, file_key, file_size, mime_type, checksum, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [pr.id, documentTypeId, safeName, key, buffer.length, mime, checksum, user.id],
      );
      return reply.status(201).send({ data: { id: rows[0].id, fileName: safeName } });
    },
  );

  // GET /:id/file/:fileId — owner-scoped download-proxy (S3-ключ наружу не отдаём).
  fastify.get<{ Params: { id: string; fileId: string } }>(
    '/:id/file/:fileId',
    async (request, reply) => {
      const user = request.currentUser;
      const isContractor = user.role === 'contractor';
      const ownerFilter = isContractor ? 'AND pr.contractor_id = $3' : '';
      const params: unknown[] = [request.params.fileId, request.params.id];
      if (isContractor) {
        if (!user.orgId) return reply.status(403).send({ error: 'Нет доступа' });
        params.push(user.orgId);
      }
      const { rows } = await fastify.pool.query(
        `SELECT f.file_key, f.file_name, f.mime_type
           FROM payment_request_files f
           JOIN payment_requests pr ON pr.id = f.payment_request_id
          WHERE f.id = $1 AND f.payment_request_id = $2 ${ownerFilter}`,
        params,
      );
      const f = rows[0];
      if (!f || !fastify.storage) return reply.status(404).send({ error: 'Файл не найден' });
      const obj = await fastify.storage.getObject(f.file_key);
      // MIME — из хранимого (server-derived) значения; принудительно attachment + nosniff,
      // чтобы браузер не рендерил загруженный файл как HTML (защита от XSS).
      reply.type(f.mime_type || 'application/octet-stream');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header(
        'Content-Disposition',
        `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
      );
      return reply.send(obj.body);
    },
  );

  // DELETE /:id/files/:fileId — удалить файл черновика (+ очистка S3).
  fastify.delete<{ Params: { id: string; fileId: string } }>(
    '/:id/files/:fileId',
    { preHandler: [requireRole('contractor')] },
    async (request, reply) => {
      const user = request.currentUser;
      if (!user.orgId) return reply.status(400).send({ error: 'Нет организации' });
      const pr = await loadOwned(request.params.id, user.orgId);
      if (!pr) return reply.status(404).send({ error: 'Заявка не найдена' });
      if (pr.lifecycle_state !== 'draft') return reply.status(409).send({ error: 'Заявка уже отправлена' });
      const { rows } = await fastify.pool.query(
        `DELETE FROM payment_request_files WHERE id = $1 AND payment_request_id = $2 RETURNING file_key`,
        [request.params.fileId, pr.id],
      );
      if (rows[0] && fastify.storage) await fastify.storage.deleteObject(rows[0].file_key);
      return { data: { ok: true } };
    },
  );

  // ============================================================
  // POST /:id/submit — отправить заявку в BillHub (через outbox, транзакционно)
  // ============================================================
  fastify.post<{ Params: { id: string } }>(
    '/:id/submit',
    { preHandler: [requireRole('contractor')] },
    async (request, reply) => {
      const user = request.currentUser;
      if (!user.orgId) return reply.status(400).send({ error: 'Нет организации' });
      const pr = await loadOwned(request.params.id, user.orgId);
      if (!pr) return reply.status(404).send({ error: 'Заявка не найдена' });
      if (pr.lifecycle_state === 'submitted') {
        return { data: { id: pr.id, lifecycleState: 'submitted', deduped: true } };
      }

      // Полнота комплекта (счёт обязателен ДО старта согласования в BillHub).
      const filesRes = await fastify.pool.query(
        `SELECT id, file_key, file_name, mime_type, file_size, bh_document_type_id
           FROM payment_request_files WHERE payment_request_id = $1`,
        [pr.id],
      );
      const missing: string[] = [];
      if (!pr.bh_supplier_id) missing.push('поставщик');
      if (!pr.bh_shipping_condition_id) missing.push('условия отгрузки');
      if (!pr.delivery_days) missing.push('срок поставки');
      if (!pr.invoice_amount) missing.push('сумма счёта');
      if (filesRes.rows.length === 0) missing.push('счёт (файл)');
      if (missing.length) {
        return reply.status(400).send({ error: `Не заполнено: ${missing.join(', ')}` });
      }

      // Проект/ИНН для маппинга на стороне BillHub (site/counterparty он резолвит сам).
      const ctx = await fastify.pool.query(
        `SELECT p.code AS project_code FROM projects p WHERE p.id = $1`,
        [pr.project_id],
      );
      const request_payload = {
        requestType: 'contractor',
        projectCode: ctx.rows[0]?.project_code ?? null,
        contractorName: pr.contractor_name,
        contractorInn: pr.contractor_inn,
        supplierId: pr.bh_supplier_id,
        supplierInn: pr.bh_supplier_inn,
        shippingConditionId: pr.bh_shipping_condition_id,
        deliveryDays: pr.delivery_days,
        deliveryDaysType: pr.delivery_days_type,
        invoiceAmount: Number(pr.invoice_amount),
        comment: pr.comment,
      };
      const files = filesRes.rows.map((f) => ({
        fileKey: f.file_key,
        fileName: f.file_name,
        mimeType: f.mime_type,
        fileSize: f.file_size,
        documentTypeId: f.bh_document_type_id,
      }));
      const payload = { paymentRequestId: pr.id, externalRef: pr.external_ref, request: request_payload, files };
      const payloadHash = canonicalHash({ request: request_payload, files });

      // Транзакция: перевод в submitted + запись команды в outbox (один COMMIT).
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE payment_requests SET lifecycle_state = 'submitted' WHERE id = $1`,
          [pr.id],
        );
        await client.query(
          `INSERT INTO integration_outbox
             (aggregate_type, aggregate_id, command_type, external_ref, payload, payload_hash, status, next_attempt_at)
           VALUES ('payment_request', $1, 'payment_request.submit', $2, $3, $4, 'queued', now())`,
          [pr.id, pr.external_ref, JSON.stringify(payload), payloadHash],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      // Fast-path: немедленная попытка доставки (не блокирует ответ; lease не даст дубля с воркером).
      fastify.outbox.kick();
      const syncState = config.billhub.outboundEnabled ? 'queued' : 'waiting_config';
      return { data: { id: pr.id, lifecycleState: 'submitted', syncState } };
    },
  );

  // ============================================================
  // GET / — список заявок на оплату подрядчика; GET /:id — карточка
  // ============================================================
  fastify.get('/', async (request) => {
    const user = request.currentUser;
    const isContractor = user.role === 'contractor';
    const where = isContractor ? 'WHERE pr.contractor_id = $1' : '';
    const params = isContractor ? [user.orgId] : [];
    const { rows } = await fastify.pool.query(
      `SELECT pr.id, pr.bh_request_number, pr.lifecycle_state, pr.status_code, pr.action_required,
              pr.revision_comment, pr.rp_number, pr.rp_date, pr.paid_status, pr.total_paid,
              pr.invoice_amount, pr.bh_supplier_name, pr.bh_request_url, pr.created_at,
              pr.contractor_name, pr.project_id
         FROM payment_requests pr
         ${where}
        ORDER BY pr.created_at DESC`,
      params,
    );
    return { data: rows };
  });

  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = request.currentUser;
    const isContractor = user.role === 'contractor';
    const params: unknown[] = [request.params.id];
    let where = 'pr.id = $1';
    if (isContractor) {
      if (!user.orgId) return reply.status(403).send({ error: 'Нет доступа' });
      params.push(user.orgId);
      where += ' AND pr.contractor_id = $2';
    }
    const { rows } = await fastify.pool.query(
      `SELECT pr.* FROM payment_requests pr WHERE ${where}`,
      params,
    );
    const pr = rows[0];
    if (!pr) return reply.status(404).send({ error: 'Заявка не найдена' });
    const files = await fastify.pool.query(
      `SELECT id, file_name, mime_type, file_size, sync_status FROM payment_request_files WHERE payment_request_id = $1`,
      [pr.id],
    );
    const history = await fastify.pool.query(
      `SELECT event_type, aggregate_version, detail, created_at
         FROM payment_request_history WHERE payment_request_id = $1 ORDER BY created_at`,
      [pr.id],
    );
    return { data: { ...pr, files: files.rows, history: history.rows } };
  });
}
