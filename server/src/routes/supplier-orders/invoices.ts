/**
 * Счета заказа поставщику — платёжные документы уже выбранного поставщика (0078).
 *
 * Вынесено в суброутер, а не дописано в index.ts: тот и без счетов почти 1900 строк. Регистрируется
 * внутри supplierOrderRoutes, поэтому префикс /supplier-orders и хуки авторизации наследуются.
 *
 * Отличие от документов предложений (offers): те принадлежат конкурсу и живут на стадии сбора КП,
 * а счёт выставляет уже выбранный поставщик, и счетов может быть несколько (правка состава или
 * смена поставщика требуют нового документа).
 */
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { upsertInvoiceSchema, PROCUREMENT_ASSIGN_ROLES } from '@estimat/shared';
import { requireRole } from '../../middleware/requireRole.js';
import { assertOrderAccessForOrder } from '../../lib/procurement/access.js';
import { appendOrderAudit } from '../../lib/supplier-orders/helpers.js';
import { guardedStreamUpload, FileGuardError } from '../../lib/uploads/file-guard.js';
import { runInvoiceRecognition, requeueStaleRecognitions } from '../../lib/invoice-recognition/run.js';

const FILE_LIMIT = 50 * 1024 * 1024; // как у документов предложений

/** Стадии, на которых счёт имеет смысл: поставщик уже определён либо вот-вот будет. */
const INVOICE_STAGES = ['sourcing', 'approval', 'awarded'] as const;

export default async function supplierOrderInvoiceRoutes(fastify: FastifyInstance) {
  /** Удалять документ поставщика может только тот, кто ведёт закупку целиком. */
  const canManageInvoices = requireRole(...PROCUREMENT_ASSIGN_ROLES);

  // Прогон, брошенный упавшим процессом, иначе навсегда остался бы «распознаётся». Проверяем
  // редко: это страховка на случай деплоя посреди вызова, а не рабочая очередь.
  const staleTimer = setInterval(() => { void requeueStaleRecognitions(fastify); }, 5 * 60_000);
  staleTimer.unref();
  fastify.addHook('onClose', async () => { clearInterval(staleTimer); });

  async function loadOrder(db: Pool | PoolClient, id: string, lock = false) {
    const { rows } = await db.query(
      `SELECT id, project_id, sourcing_status, invoice_revision FROM supplier_orders
        WHERE id = $1 AND kind = 'sourcing'${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows[0] as
      | { id: string; project_id: string | null; sourcing_status: string; invoice_revision: number }
      | undefined;
  }

  // ============================================================
  // GET /:id/invoices — список счетов заказа (без ключей S3).
  // ============================================================
  fastify.get<{ Params: { id: string } }>('/:id/invoices', async (request, reply) => {
    const order = await loadOrder(fastify.pool, request.params.id);
    if (!order) return reply.status(404).send({ error: 'Заказ не найден' });
    const access = await assertOrderAccessForOrder(fastify.pool, request.currentUser, order.id);
    if (!access.ok) return reply.status(403).send({ error: access.reason });

    const { rows } = await fastify.pool.query(
      `SELECT i.id, i.invoice_revision, i.invoice_no, to_char(i.invoice_date, 'YYYY-MM-DD') AS invoice_date,
              i.amount, i.vat_amount, i.vat_rate, i.supplier_name, i.supplier_inn, i.source,
              i.file_name, i.mime_type, i.file_size, i.note,
              i.recognition_status, i.recognition_error, i.recognized, i.match_result, i.match_status,
              i.superseded_at, i.superseded_reason, i.created_at, u.full_name AS uploaded_by_name
         FROM supplier_order_invoices i
         LEFT JOIN users u ON u.id = i.uploaded_by
        WHERE i.order_id = $1
        ORDER BY i.superseded_at NULLS FIRST, i.created_at DESC`,
      [order.id],
    );
    return { data: rows };
  });

  // ============================================================
  // POST /:id/invoices — приложить счёт (multipart).
  //   Схема та же, что у документов предложений: проверяем ДО приёма 50 МБ, затем повторно вместе
  //   с записью в транзакции (за время передачи заказ мог уйти в другую стадию), при откате чистим
  //   уже залитый объект.
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/invoices', async (request, reply) => {
    const user = request.currentUser;
    const order = await loadOrder(fastify.pool, request.params.id);
    if (!order) return reply.status(404).send({ error: 'Заказ не найден' });
    if (!INVOICE_STAGES.includes(order.sourcing_status as never)) {
      return reply.status(409).send({ error: 'Счёт прикладывают к заказу с выбранным поставщиком' });
    }
    const preAccess = await assertOrderAccessForOrder(fastify.pool, user, order.id);
    if (!preAccess.ok) return reply.status(403).send({ error: preAccess.reason });
    if (!fastify.storage) return reply.status(503).send({ error: 'Хранилище файлов не настроено' });

    const file = await request.file({ limits: { fileSize: FILE_LIMIT } });
    if (!file) return reply.status(400).send({ error: 'Файл не загружен' });

    try {
      const meta = await guardedStreamUpload(
        fastify.storage, file.file, file.filename, `supplier-orders/${order.id}/invoices`,
      );
      if (file.file.truncated) {
        await fastify.storage.deleteObject(meta.key);
        return reply.status(400).send({ error: 'Файл больше 50 МБ' });
      }

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const fresh = await loadOrder(client, order.id, true);
        if (!fresh || !INVOICE_STAGES.includes(fresh.sourcing_status as never)) {
          await client.query('ROLLBACK');
          await fastify.storage.deleteObject(meta.key).catch(() => {});
          return reply.status(409).send({ error: 'Заказ изменился, пока загружался файл — счёт не сохранён' });
        }
        const access = await assertOrderAccessForOrder(client, user, order.id);
        if (!access.ok) {
          await client.query('ROLLBACK');
          await fastify.storage.deleteObject(meta.key).catch(() => {});
          return reply.status(403).send({ error: access.reason });
        }

        // Прежние действующие счета ТОЙ ЖЕ ревизии замещаются: актуальным считается последний.
        // Счета прошлых ревизий не трогаем — они относятся к другому состоянию заказа.
        await client.query(
          `UPDATE supplier_order_invoices
              SET superseded_at = now(), superseded_reason = 'replaced'
            WHERE order_id = $1 AND superseded_at IS NULL AND invoice_revision = $2`,
          [order.id, fresh.invoice_revision],
        );
        const { rows: ins } = await client.query(
          `INSERT INTO supplier_order_invoices
             (order_id, invoice_revision, file_key, file_name, mime_type, checksum, file_size, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [order.id, fresh.invoice_revision, meta.key, meta.safeName, meta.mime, meta.checksum, meta.size, user.id],
        );
        await appendOrderAudit(client, {
          orderId: order.id, action: 'invoice_added', userId: user.id,
          changes: { fileName: meta.safeName, invoiceRevision: fresh.invoice_revision },
          projectId: order.project_id,
        });
        await client.query('COMMIT');
        // Распознавание — в фоне: вызов модели идёт до двух минут, и держать на нём HTTP-запрос
        // значит упереться в таймауты прокси. Отказ распознавания на загрузку счёта не влияет.
        void runInvoiceRecognition(fastify, ins[0].id as string);
        return reply.status(201).send({ data: { id: ins[0].id, fileName: meta.safeName } });
      } catch (dbErr) {
        await client.query('ROLLBACK').catch(() => {});
        await fastify.storage.deleteObject(meta.key).catch(() => {});
        throw dbErr;
      } finally {
        client.release();
      }
    } catch (e) {
      if (e instanceof FileGuardError) return reply.status(e.status).send({ error: e.message });
      throw e;
    }
  });

  // ============================================================
  // GET /:id/invoices/:invoiceId/file — download-proxy (ключ S3 наружу не отдаём).
  // ============================================================
  fastify.get<{ Params: { id: string; invoiceId: string } }>('/:id/invoices/:invoiceId/file', async (request, reply) => {
    const access = await assertOrderAccessForOrder(fastify.pool, request.currentUser, request.params.id);
    if (!access.ok) return reply.status(403).send({ error: access.reason });

    const { rows } = await fastify.pool.query(
      `SELECT file_key, file_name, mime_type FROM supplier_order_invoices WHERE id = $1 AND order_id = $2`,
      [request.params.invoiceId, request.params.id],
    );
    const f = rows[0];
    if (!f || !f.file_key || !fastify.storage) return reply.status(404).send({ error: 'Файл не найден' });

    const obj = await fastify.storage.getObject(f.file_key);
    reply.type(f.mime_type || 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (obj.contentLength != null) reply.header('Content-Length', obj.contentLength);
    reply.header(
      'Content-Disposition',
      `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.file_name || 'file')}`,
    );
    return reply.send(obj.body);
  });

  // ============================================================
  // PATCH /:id/invoices/:invoiceId — реквизиты счёта (ручной ввод или правка распознанного).
  // ============================================================
  fastify.patch<{ Params: { id: string; invoiceId: string } }>('/:id/invoices/:invoiceId', async (request, reply) => {
    const user = request.currentUser;
    const body = upsertInvoiceSchema.parse(request.body);
    const order = await loadOrder(fastify.pool, request.params.id);
    if (!order) return reply.status(404).send({ error: 'Заказ не найден' });
    const access = await assertOrderAccessForOrder(fastify.pool, user, order.id);
    if (!access.ok) return reply.status(403).send({ error: access.reason });

    // Правка человеком помечает источник: распознанное, но выверенное значение — не то же самое,
    // что сырой ответ модели. 'manual' остаётся 'manual'.
    const { rows } = await fastify.pool.query(
      `UPDATE supplier_order_invoices
          SET invoice_no = $3, invoice_date = $4, amount = $5, vat_amount = $6, note = $7,
              source = CASE WHEN source = 'llm' THEN 'llm_edited' ELSE source END
        WHERE id = $1 AND order_id = $2
        RETURNING id`,
      [
        request.params.invoiceId, order.id,
        body.invoiceNo ?? null, body.invoiceDate ?? null,
        body.amount ?? null, body.vatAmount ?? null, body.note ?? null,
      ],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Счёт не найден' });

    await appendOrderAudit(fastify.pool, {
      orderId: order.id, action: 'invoice_updated', userId: user.id,
      changes: { invoiceNo: body.invoiceNo ?? null, invoiceDate: body.invoiceDate ?? null },
      projectId: order.project_id,
    });
    return { data: { ok: true } };
  });

  // ============================================================
  // POST /:id/invoices/:invoiceId/recognize — распознать повторно.
  //   Нужен после сбоя модели и после правки состава: сверка считается против текущего заказа.
  // ============================================================
  fastify.post<{ Params: { id: string; invoiceId: string } }>(
    '/:id/invoices/:invoiceId/recognize',
    async (request, reply) => {
      const order = await loadOrder(fastify.pool, request.params.id);
      if (!order) return reply.status(404).send({ error: 'Заказ не найден' });
      const access = await assertOrderAccessForOrder(fastify.pool, request.currentUser, order.id);
      if (!access.ok) return reply.status(403).send({ error: access.reason });

      // Счётчик попыток обнуляем: это осознанный повтор человеком, а не автоматический ретрай.
      const { rows } = await fastify.pool.query(
        `UPDATE supplier_order_invoices
            SET recognition_status = 'queued', recognition_error = NULL, attempts = 0,
                locked_by = NULL, locked_until = NULL
          WHERE id = $1 AND order_id = $2
          RETURNING id`,
        [request.params.invoiceId, order.id],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'Счёт не найден' });

      void runInvoiceRecognition(fastify, rows[0].id as string);
      return { data: { ok: true, recognitionStatus: 'queued' } };
    },
  );

  // ============================================================
  // DELETE /:id/invoices/:invoiceId — убрать ошибочно приложенный счёт (админ/руководитель).
  //   Обычный путь — замещение новым счётом; удаление нужно только для явных ошибок загрузки.
  // ============================================================
  fastify.delete<{ Params: { id: string; invoiceId: string } }>(
    '/:id/invoices/:invoiceId',
    { preHandler: [canManageInvoices] },
    async (request, reply) => {
      const user = request.currentUser;
      const order = await loadOrder(fastify.pool, request.params.id);
      if (!order) return reply.status(404).send({ error: 'Заказ не найден' });

      const orphan: { key: string | null } = { key: null };
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: del } = await client.query(
          `DELETE FROM supplier_order_invoices WHERE id = $1 AND order_id = $2 RETURNING file_key, file_name`,
          [request.params.invoiceId, order.id],
        );
        if (!del[0]) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Счёт не найден' });
        }
        orphan.key = del[0].file_key ?? null;
        await appendOrderAudit(client, {
          orderId: order.id, action: 'invoice_removed', userId: user.id,
          changes: { fileName: del[0].file_name }, projectId: order.project_id,
        });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      // Объект в S3 удаляем ПОСЛЕ коммита: откат транзакции не вернул бы уже удалённый файл.
      if (orphan.key && fastify.storage) await fastify.storage.deleteObject(orphan.key).catch(() => {});
      return { data: { ok: true } };
    },
  );
}
