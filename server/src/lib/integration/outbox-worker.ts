/**
 * Исходящая очередь команд EstiMat → внешние системы (transactional outbox).
 * Провайдеры: BillHub (payment_request.submit) и PayHub (rp_letter.sync — догрузка вложений РП).
 *
 * Надёжность:
 *  - claim строк через FOR UPDATE SKIP LOCKED + lease (locked_until, lease_token) — несколько
 *    экземпляров API и fast-path не отправят одну команду дважды; зависший lease перезабирается;
 *  - fenced lease: финальные апдейты статуса делаются только владельцем текущего lease_token
 *    (WHERE lease_token=$token) — старый воркер не завершит перезахваченную команду;
 *  - сеть выполняется ПОСЛЕ фиксации claim; экспоненциальный backoff; постоянные ошибки и
 *    превышение лимита → dead_letter; недоступность конфигурации провайдера → waiting_config;
 *  - гейт доступности — per-command (выключенный BillHub не блокирует PayHub-команды и наоборот).
 */
import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { config } from '../../config.js';
import { billhub, BillhubError } from '../billhub/client.js';
import { getPayHubClient } from '../payhub/client.js';
import { PayHubApiError, PayHubNotConfiguredError, PayHubWaitingConfigError } from '../payhub/errors.js';
import { syncRpLetterAttachments } from '../payhub/rp-sync.js';
import { getTenderClient, type CreateTenderInput } from '../tender/client.js';
import { TenderApiError, TenderNotConfiguredError } from '../tender/errors.js';
import { recalcRequestStatus } from '../requests/status-recalc.js';
import { appendOrderAudit } from '../supplier-orders/helpers.js';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const BATCH = 10;
const LEASE_MS = 120_000; // 2 мин — на время доставки
const MAX_ATTEMPTS = 12; // после — dead_letter
const BASE_BACKOFF_SEC = 30;
const BACKOFF_CAP_SEC = 3600;
const WAITING_RETRY_SEC = 300; // как часто пересматривать waiting_config

function backoffSeconds(attempts: number): number {
  return Math.min(BACKOFF_CAP_SEC, BASE_BACKOFF_SEC * 2 ** Math.min(attempts, 20));
}

interface OutboxRow {
  id: string;
  aggregate_id: string;
  command_type: string;
  external_ref: string | null;
  payload: Record<string, unknown>;
  payload_hash: string;
  attempts: number;
  lease_token: string;
}

/** Единый вид ошибки доставки (независимый от провайдера). */
interface IntErr {
  retryable: boolean;
  code: string;
  message: string;
  waitingConfig?: boolean;
}

function toIntErr(e: unknown): IntErr {
  if (e instanceof PayHubWaitingConfigError) return { retryable: false, code: 'waiting_config', message: e.message, waitingConfig: true };
  if (e instanceof PayHubNotConfiguredError) return { retryable: false, code: 'not_configured', message: e.message, waitingConfig: true };
  if (e instanceof PayHubApiError) return { retryable: e.retryable, code: e.code, message: e.message };
  if (e instanceof BillhubError) return { retryable: e.retryable, code: e.code, message: e.message };
  if (e instanceof TenderNotConfiguredError) return { retryable: false, code: 'not_configured', message: e.message, waitingConfig: true };
  if (e instanceof TenderApiError) return { retryable: e.retryable, code: e.code, message: e.message };
  return { retryable: true, code: 'internal', message: (e as Error).message };
}

export interface OutboxWorker {
  start(): void;
  stop(): Promise<void>;
  /** Немедленная попытка (fast-path после COMMIT). Не пересекается с плановой итерацией. */
  kick(): void;
}

export function createOutboxWorker(fastify: FastifyInstance): OutboxWorker {
  let timer: NodeJS.Timeout | null = null;
  let running = false; // overlap-guard
  let activeTick: Promise<void> | null = null;
  let stopped = false;

  async function claim(): Promise<OutboxRow[]> {
    const { rows } = await fastify.pool.query<OutboxRow>(
      `WITH claimed AS (
         SELECT id FROM integration_outbox
          WHERE status IN ('queued','retry_wait','waiting_config')
            AND next_attempt_at <= now()
            AND (locked_until IS NULL OR locked_until <= now())
          ORDER BY next_attempt_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE integration_outbox o
          SET lease_token = gen_random_uuid(),
              locked_until = now() + ($2::text || ' milliseconds')::interval,
              last_attempt_at = now()
         FROM claimed c
        WHERE o.id = c.id
      RETURNING o.id, o.aggregate_id, o.command_type, o.external_ref,
                o.payload, o.payload_hash, o.attempts, o.lease_token`,
      [BATCH, LEASE_MS],
    );
    return rows;
  }

  // Финальные апдесты — только владельцем текущего lease (fenced).
  async function markDelivered(row: OutboxRow) {
    await fastify.pool.query(
      `UPDATE integration_outbox
          SET status='delivered', delivered_at=now(), locked_until=NULL, lease_token=NULL, error_code=NULL
        WHERE id=$1 AND lease_token=$2`,
      [row.id, row.lease_token],
    );
  }

  async function markWaitingConfig(row: OutboxRow) {
    await fastify.pool.query(
      `UPDATE integration_outbox
          SET status='waiting_config', locked_until=NULL, lease_token=NULL,
              next_attempt_at = now() + ($2::text || ' seconds')::interval
        WHERE id=$1 AND lease_token=$3`,
      [row.id, WAITING_RETRY_SEC, row.lease_token],
    );
  }

  async function markRetryOrDead(row: OutboxRow, err: IntErr) {
    const attempts = row.attempts + 1;
    const permanent = !err.retryable || attempts >= MAX_ATTEMPTS;
    if (permanent) {
      await fastify.pool.query(
        `UPDATE integration_outbox
            SET status='dead_letter', attempts=$2, error_code=$3, last_error=$4,
                locked_until=NULL, lease_token=NULL
          WHERE id=$1 AND lease_token=$5`,
        [row.id, attempts, err.code, err.message.slice(0, 500), row.lease_token],
      );
      fastify.log.error(
        { outboxId: row.id, externalRef: row.external_ref, code: err.code, command: row.command_type },
        'outbox: команда в dead_letter',
      );
    } else {
      await fastify.pool.query(
        `UPDATE integration_outbox
            SET status='retry_wait', attempts=$2, error_code=$3, last_error=$4,
                locked_until=NULL, lease_token=NULL,
                next_attempt_at = now() + ($5::text || ' seconds')::interval
          WHERE id=$1 AND lease_token=$6`,
        [row.id, attempts, err.code, err.message.slice(0, 500), backoffSeconds(attempts), row.lease_token],
      );
    }
  }

  /** BillHub: создание заявки на оплату (import → confirm files → submit). */
  async function deliverSubmit(row: OutboxRow): Promise<void> {
    const p = row.payload as unknown as {
      paymentRequestId: string;
      externalRef: string;
      request: Record<string, unknown>;
      files: { fileKey: string; fileName: string; mimeType: string | null; fileSize: number | null; documentTypeId: string | null }[];
    };
    const session = await billhub.createImportSession({
      externalRef: p.externalRef,
      payloadHash: row.payload_hash,
      request: p.request,
    });

    for (const f of p.files) {
      const contentType = f.mimeType || 'application/octet-stream';
      const up = await billhub.requestFileUploadUrl(session.importId, { fileName: f.fileName, contentType });
      if (!fastify.storage) throw new BillhubError('S3-хранилище EstiMat не сконфигурировано', 0, 'no_storage', false);
      const obj = await fastify.storage.getObject(f.fileKey);
      const bytes = await streamToBuffer(obj.body);
      await billhub.putFileBytes(up.uploadUrl, bytes, contentType);
      const confirmed = await billhub.confirmImportFile(session.importId, {
        fileKey: up.fileKey,
        documentTypeId: f.documentTypeId,
        fileName: f.fileName,
        fileSize: f.fileSize ?? bytes.length,
        mimeType: contentType,
      });
      await fastify.pool.query(
        `UPDATE payment_request_files SET sync_status='synced', bh_file_id=$2
          WHERE payment_request_id=$1 AND file_key=$3`,
        [p.paymentRequestId, confirmed.fileId, f.fileKey],
      );
    }

    const result = await billhub.submitImport(session.importId);
    await fastify.pool.query(
      `UPDATE payment_requests
          SET bh_request_id=$2, bh_request_number=$3, bh_request_url=$4,
              status_code = COALESCE(status_code, 'approv_shtab'),
              last_bh_version = GREATEST(last_bh_version, $5)
        WHERE id=$1`,
      [p.paymentRequestId, result.requestId, result.number, result.url ?? null, result.aggregateVersion ?? 0],
    );
  }

  /** PayHub: догрузка вложений РП-письма (письмо уже создано синхронно в rp-send). */
  async function deliverRpLetterSync(row: OutboxRow): Promise<void> {
    const p = row.payload as unknown as { rpLetterId: string };
    const client = getPayHubClient();
    if (!client) throw new PayHubNotConfiguredError();
    if (!fastify.storage) throw new PayHubApiError('S3-хранилище EstiMat не сконфигурировано', 0, 'no_storage', false);
    const { rows } = await fastify.pool.query(
      `SELECT id, payhub_letter_id, sync_status FROM rp_letters WHERE id = $1`,
      [p.rpLetterId],
    );
    const rl = rows[0];
    // Нет письма / письмо аннулировано (удалено в PayHub) — грузить нечего, статус не трогаем.
    if (!rl || !rl.payhub_letter_id || rl.sync_status === 'annulled') return;
    try {
      await syncRpLetterAttachments(fastify.pool, fastify.storage, client, {
        id: rl.id,
        payhubLetterId: rl.payhub_letter_id,
      });
      await fastify.pool.query(`UPDATE rp_letters SET sync_status='synced', last_error=NULL WHERE id=$1`, [rl.id]);
    } catch (e) {
      await fastify.pool.query(
        `UPDATE rp_letters SET sync_status='failed', last_error=$2 WHERE id=$1`,
        [rl.id, (e as Error).message.slice(0, 500)],
      );
      throw e;
    }
  }

  // Надёжно (идемпотентно по partial-unique) ставит команду отмены тендера в очередь.
  async function enqueueTenderCancel(orderId: string, externalRef: string | null): Promise<void> {
    const hash = createHash('sha256').update(`tender.cancel:${orderId}`).digest('hex');
    await fastify.pool.query(
      `INSERT INTO integration_outbox
         (aggregate_type, aggregate_id, command_type, external_ref, payload, payload_hash, status, next_attempt_at)
       VALUES ('supplier_order', $1, 'tender.cancel', $2, $3::jsonb, $4, 'queued', now())
       ON CONFLICT (aggregate_id, command_type)
         WHERE command_type IN ('tender.create','tender.cancel')
           AND status IN ('queued','retry_wait','waiting_config')
       DO NOTHING`,
      [orderId, externalRef, JSON.stringify({ orderId }), hash],
    );
  }

  // Прервать создание тендера, когда отмена опередила выгрузку: тендер на портал не отправляем,
  // лот → cancelled, остаток заявок освобождаем (пересчёт статусов). Выполняется в транзакции.
  async function abortTenderCreate(orderId: string, projectId: string | null): Promise<void> {
    const c = await fastify.pool.connect();
    try {
      await c.query('BEGIN');
      const { rowCount } = await c.query(
        `UPDATE supplier_orders
            SET sourcing_status='cancelled', tender_sync_status='cancelled',
                row_version=row_version+1, updated_at=now()
          WHERE id=$1 AND sourcing_status NOT IN ('cancelled','no_award','awarded')`,
        [orderId],
      );
      if (rowCount) {
        await appendOrderAudit(c, { orderId, action: 'tender_create_aborted', projectId });
        const { rows: reqRows } = await c.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [orderId]);
        for (const r of reqRows) if (r.request_id) await recalcRequestStatus(c, r.request_id, null);
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  /** Тендерный портал: создание тендера по закупочному лоту (идемпотентно по external_ref). */
  async function deliverTenderCreate(row: OutboxRow): Promise<void> {
    const client = getTenderClient();
    if (!client) throw new TenderNotConfiguredError();
    const p = row.payload as unknown as { orderId: string; input: CreateTenderInput };

    // Перечитать намерение перед сетью: отмена могла опередить создание.
    const { rows: pre } = await fastify.pool.query(
      `SELECT desired_tender_state, tender_portal_id, project_id FROM supplier_orders WHERE id=$1`,
      [p.orderId],
    );
    const lot = pre[0];
    if (!lot) return; // лот исчез — команда бессмысленна (будет markDelivered)
    if (lot.desired_tender_state === 'cancelled' && !lot.tender_portal_id) {
      await abortTenderCreate(p.orderId, lot.project_id);
      return;
    }

    try {
      const tender = await client.createTender(p.input);
      await fastify.pool.query(
        `UPDATE supplier_orders
            SET tender_portal_id=$2, tender_url=$3, tender_status=$4, tender_remote_revision=$5,
                tender_sync_status='synced', tender_last_error=NULL, tender_attempts=tender_attempts+1,
                tender_next_poll_at = now() + interval '60 seconds'
          WHERE id=$1`,
        [p.orderId, tender.id, tender.url ?? null, tender.status, tender.revision ?? null],
      );
    } catch (e) {
      await fastify.pool.query(
        `UPDATE supplier_orders SET tender_sync_status='failed', tender_last_error=$2, tender_attempts=tender_attempts+1 WHERE id=$1`,
        [p.orderId, (e as Error).message.slice(0, 500)],
      );
      throw e;
    }

    // Пока создавали — лот успели пометить к отмене: надёжно ставим команду отмены тендера.
    const { rows: post } = await fastify.pool.query(
      `SELECT desired_tender_state, tender_external_ref FROM supplier_orders WHERE id=$1`,
      [p.orderId],
    );
    if (post[0]?.desired_tender_state === 'cancelled') {
      await fastify.pool.query(
        `UPDATE supplier_orders SET sourcing_status='cancel_pending', tender_next_poll_at=now()
          WHERE id=$1 AND sourcing_status NOT IN ('cancelled','no_award','awarded')`,
        [p.orderId],
      );
      await enqueueTenderCancel(p.orderId, post[0].tender_external_ref);
    }
  }

  /** Тендерный портал: отмена тендера по лоту (надёжно, с ретраями). Подтверждение — через poller. */
  async function deliverTenderCancel(row: OutboxRow): Promise<void> {
    const client = getTenderClient();
    if (!client) throw new TenderNotConfiguredError();
    const p = row.payload as unknown as { orderId: string };
    const { rows } = await fastify.pool.query(
      `SELECT tender_portal_id FROM supplier_orders WHERE id=$1`,
      [p.orderId],
    );
    const portalId = rows[0]?.tender_portal_id;
    if (!portalId) return; // тендер не создан — отменять нечего
    try {
      await client.cancelTender(portalId);
      // Успех: поллер увидит 'cancelled' и освободит остаток. Инициируем скорый опрос.
      await fastify.pool.query(`UPDATE supplier_orders SET tender_next_poll_at=now() WHERE id=$1`, [p.orderId]);
    } catch (e) {
      // Отмена невозможна после дедлайна — возвращаем намерение в active, остаток НЕ освобождаем.
      if (e instanceof TenderApiError && e.code === 'cannot_cancel_after_deadline') {
        await fastify.pool.query(
          `UPDATE supplier_orders
              SET desired_tender_state='active',
                  sourcing_status = CASE WHEN sourcing_status='cancel_pending' THEN 'sourcing' ELSE sourcing_status END,
                  tender_last_error=$2, updated_at=now()
            WHERE id=$1`,
          [p.orderId, e.message.slice(0, 500)],
        );
      }
      throw e;
    }
  }

  async function process(row: OutboxRow): Promise<void> {
    try {
      if (row.command_type === 'payment_request.submit') {
        if (!config.billhub.outboundEnabled) return await markWaitingConfig(row);
        await deliverSubmit(row);
        await markDelivered(row);
      } else if (row.command_type === 'rp_letter.sync') {
        if (!config.payhub.configured) return await markWaitingConfig(row);
        await deliverRpLetterSync(row);
        await markDelivered(row);
      } else if (row.command_type === 'tender.create') {
        if (!config.tender.outboundEnabled) return await markWaitingConfig(row);
        await deliverTenderCreate(row);
        await markDelivered(row);
      } else if (row.command_type === 'tender.cancel') {
        if (!config.tender.outboundEnabled) return await markWaitingConfig(row);
        await deliverTenderCancel(row);
        await markDelivered(row);
      } else {
        await markRetryOrDead(row, { retryable: false, code: 'unknown_command', message: `Неизвестный тип команды: ${row.command_type}` });
      }
    } catch (e) {
      const err = toIntErr(e);
      if (err.waitingConfig) return await markWaitingConfig(row);
      await markRetryOrDead(row, err);
    }
  }

  async function tick(): Promise<void> {
    if (running || stopped) return;
    running = true;
    const done = (async () => {
      try {
        for (let i = 0; i < 5; i++) {
          const rows = await claim();
          if (rows.length === 0) break;
          for (const row of rows) await process(row);
        }
      } catch (e) {
        fastify.log.error({ err: e }, 'outbox tick failed');
      } finally {
        running = false;
      }
    })();
    activeTick = done;
    await done;
    activeTick = null;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), 60_000);
      setTimeout(() => void tick(), 5_000);
      fastify.log.info(
        { billhub: config.billhub.outboundEnabled, payhub: config.payhub.configured },
        'outbox worker started',
      );
    },
    kick() {
      void tick();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (activeTick) await activeTick;
    },
  };
}
