/**
 * Исходящая очередь команд EstiMat → BillHub (transactional outbox).
 *
 * Надёжность:
 *  - claim строк через FOR UPDATE SKIP LOCKED + lease (locked_until) — несколько экземпляров
 *    API и fast-path не отправят одну команду дважды; зависший lease перезабирается по TTL;
 *  - сеть выполняется ПОСЛЕ фиксации claim (короткая транзакция на claim, HTTP вне транзакции);
 *  - экспоненциальный backoff по attempts; постоянные ошибки (4xx, конфликт идемпотентности)
 *    и превышение лимита попыток → dead_letter (не молча теряем — видно в БД/логах);
 *  - при выключенном рубильнике (config.billhub.outboundEnabled=false) команды остаются в
 *    waiting_config и НЕ теряются — забираются после включения;
 *  - overlap-guard (одна активная итерация) + ожидание активной доставки при shutdown.
 *
 * Идемпотентность на стороне BillHub — по external_ref (+ payload_hash).
 */
import type { FastifyInstance } from 'fastify';
import type { Readable } from 'stream';
import { config } from '../../config.js';
import { billhub, BillhubError } from '../billhub/client.js';

const BATCH = 10;
const LEASE_MS = 120_000; // 2 мин — на время доставки
const MAX_ATTEMPTS = 12; // после — dead_letter
const BASE_BACKOFF_SEC = 30;
const BACKOFF_CAP_SEC = 3600;
const WAITING_RETRY_SEC = 300; // как часто пересматривать waiting_config

function backoffSeconds(attempts: number): number {
  return Math.min(BACKOFF_CAP_SEC, BASE_BACKOFF_SEC * 2 ** Math.min(attempts, 20));
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

interface OutboxRow {
  id: string;
  aggregate_id: string;
  command_type: string;
  external_ref: string | null;
  payload: PaymentRequestSubmitPayload;
  payload_hash: string;
  attempts: number;
}

interface SubmitFile {
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  documentTypeId: string | null;
}
interface PaymentRequestSubmitPayload {
  paymentRequestId: string;
  externalRef: string;
  request: Record<string, unknown>;
  files: SubmitFile[];
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
                o.payload, o.payload_hash, o.attempts`,
      [BATCH, LEASE_MS],
    );
    return rows;
  }

  async function markDelivered(id: string) {
    await fastify.pool.query(
      `UPDATE integration_outbox
          SET status='delivered', delivered_at=now(), locked_until=NULL, lease_token=NULL, error_code=NULL
        WHERE id=$1`,
      [id],
    );
  }

  async function markWaitingConfig(id: string) {
    await fastify.pool.query(
      `UPDATE integration_outbox
          SET status='waiting_config', locked_until=NULL, lease_token=NULL,
              next_attempt_at = now() + ($2::text || ' seconds')::interval
        WHERE id=$1`,
      [id, WAITING_RETRY_SEC],
    );
  }

  async function markRetryOrDead(row: OutboxRow, err: BillhubError) {
    const attempts = row.attempts + 1;
    const permanent = !err.retryable || attempts >= MAX_ATTEMPTS;
    if (permanent) {
      await fastify.pool.query(
        `UPDATE integration_outbox
            SET status='dead_letter', attempts=$2, error_code=$3, last_error=$4,
                locked_until=NULL, lease_token=NULL
          WHERE id=$1`,
        [row.id, attempts, err.code, err.message.slice(0, 500)],
      );
      fastify.log.error(
        { outboxId: row.id, externalRef: row.external_ref, code: err.code },
        'BillHub outbox: команда в dead_letter',
      );
    } else {
      await fastify.pool.query(
        `UPDATE integration_outbox
            SET status='retry_wait', attempts=$2, error_code=$3, last_error=$4,
                locked_until=NULL, lease_token=NULL,
                next_attempt_at = now() + ($5::text || ' seconds')::interval
          WHERE id=$1`,
        [row.id, attempts, err.code, err.message.slice(0, 500), backoffSeconds(attempts)],
      );
    }
  }

  /** Доставка одной команды создания заявки на оплату: import → confirm files → submit. */
  async function deliverSubmit(row: OutboxRow): Promise<void> {
    const p = row.payload;
    const session = await billhub.createImportSession({
      externalRef: p.externalRef,
      payloadHash: row.payload_hash,
      request: p.request,
    });

    for (const f of p.files) {
      const contentType = f.mimeType || 'application/octet-stream';
      const up = await billhub.requestFileUploadUrl(session.importId, {
        fileName: f.fileName,
        contentType,
      });
      if (!fastify.storage) {
        throw new BillhubError('S3-хранилище EstiMat не сконфигурировано', 0, 'no_storage', false);
      }
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

  async function process(row: OutboxRow): Promise<void> {
    if (!config.billhub.outboundEnabled) {
      await markWaitingConfig(row.id);
      return;
    }
    try {
      if (row.command_type === 'payment_request.submit') {
        await deliverSubmit(row);
      } else {
        throw new BillhubError(`Неизвестный тип команды: ${row.command_type}`, 0, 'unknown_command', false);
      }
      await markDelivered(row.id);
    } catch (e) {
      const err =
        e instanceof BillhubError ? e : new BillhubError((e as Error).message, 0, 'internal', true);
      await markRetryOrDead(row, err);
    }
  }

  async function tick(): Promise<void> {
    if (running || stopped) return;
    running = true;
    const done = (async () => {
      try {
        // Забираем и обрабатываем, пока есть готовые команды (но не бесконечно).
        for (let i = 0; i < 5; i++) {
          const rows = await claim();
          if (rows.length === 0) break;
          for (const row of rows) await process(row);
        }
      } catch (e) {
        fastify.log.error({ err: e }, 'BillHub outbox tick failed');
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
      // Плановая итерация каждые 60 c (waiting_config пересматривается по next_attempt_at).
      timer = setInterval(() => void tick(), 60_000);
      // Первая попытка вскоре после старта.
      setTimeout(() => void tick(), 5_000);
      fastify.log.info(
        { outboundEnabled: config.billhub.outboundEnabled },
        'BillHub outbox worker started',
      );
    },
    kick() {
      void tick();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (activeTick) await activeTick; // дождаться активной доставки
    },
  };
}
