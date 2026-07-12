/**
 * Фоновый опрос результатов тендеров с портала. Мягко тормозится при выключенном рубильнике
 * (config.tender.outboundEnabled). Claim лотов через FOR UPDATE SKIP LOCKED + продвижение
 * tender_next_poll_at (два инстанса не берут один лот); сеть — после резервирования; бэкофф
 * при ошибке; терминальные тендеры перестают опрашиваться (tender_next_poll_at=NULL в applyState).
 * Остановка — по onClose приложения.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { refreshTenderLot } from './sync.js';

const BATCH = 10;
const POLL_INTERVAL_MS = 60_000;
const CLAIM_HOLD_SEC = 60; // на сколько отодвигаем следующий опрос при claim
const BACKOFF_SEC = 300;

export interface TenderPoller {
  start(): void;
  stop(): Promise<void>;
}

export function createTenderPoller(fastify: FastifyInstance): TenderPoller {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;
  let activeTick: Promise<void> | null = null;

  // Зарезервировать пачку лотов к опросу (нетерминальный статус, срок опроса наступил).
  async function claim(): Promise<{ id: string }[]> {
    const { rows } = await fastify.pool.query<{ id: string }>(
      `WITH claimed AS (
         SELECT id FROM supplier_orders
          WHERE kind = 'sourcing' AND tender_portal_id IS NOT NULL
            AND (tender_status IS NULL OR tender_status NOT IN ('finished', 'cancelled'))
            AND (tender_next_poll_at IS NULL OR tender_next_poll_at <= now())
          ORDER BY tender_next_poll_at NULLS FIRST
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE supplier_orders o
          SET tender_next_poll_at = now() + ($2::text || ' seconds')::interval,
              tender_last_polled_at = now()
         FROM claimed c WHERE o.id = c.id
       RETURNING o.id`,
      [BATCH, CLAIM_HOLD_SEC],
    );
    return rows;
  }

  async function tick(): Promise<void> {
    if (running || stopped) return;
    if (!config.tender.outboundEnabled) return; // рубильник выключен — спим
    running = true;
    const done = (async () => {
      try {
        const rows = await claim();
        for (const lot of rows) {
          try {
            await refreshTenderLot(fastify, lot.id);
          } catch (e) {
            await fastify.pool.query(
              `UPDATE supplier_orders
                  SET tender_last_error = $2, tender_next_poll_at = now() + ($3::text || ' seconds')::interval
                WHERE id = $1`,
              [lot.id, (e as Error).message.slice(0, 500), BACKOFF_SEC],
            );
          }
        }
      } catch (e) {
        fastify.log.error({ err: e }, 'tender poller tick failed');
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
      timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
      setTimeout(() => void tick(), 10_000);
      fastify.log.info({ tender: config.tender.outboundEnabled }, 'tender poller started');
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (activeTick) await activeTick;
    },
  };
}
