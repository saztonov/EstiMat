/**
 * Опрос результатов тендера с портала и применение состояния к закупочному лоту.
 * Используется и фоновым poller-ом, и ручным «Обновить результаты». Сеть выполняется здесь;
 * планирование следующего опроса/бэкофф — на стороне poller (см. poller.ts).
 *
 * Инвариант И5: результаты НИКОГДА не перезаписывают финальный award — только сохраняются
 * (tender_status/tender_results). Победитель фиксируется отдельной операцией award.
 */
import type { FastifyInstance } from 'fastify';
import type { TenderDto, TenderResultsDto } from '@estimat/shared';
import { getTenderClient } from './client.js';
import { TenderApiError, TenderNotConfiguredError } from './errors.js';
import { recalcRequestStatus } from '../requests/status-recalc.js';
import { appendOrderAudit } from '../supplier-orders/helpers.js';

const TERMINAL = new Set(['finished', 'cancelled']);

interface LotRow {
  id: string;
  tender_portal_id: string | null;
  sourcing_status: string;
  tender_status: string | null;
  project_id: string | null;
}

// Применить снимок состояния тендера к лоту (транзакция). Подтверждённая отмена (cancel_pending →
// портал 'cancelled') освобождает остаток заявок; терминальный статус останавливает опрос.
async function applyState(fastify: FastifyInstance, lot: LotRow, t: TenderDto, results: TenderResultsDto | null): Promise<void> {
  const client = await fastify.pool.connect();
  try {
    await client.query('BEGIN');
    const nextPoll = TERMINAL.has(t.status) ? null : undefined; // null → остановить опрос; undefined → не трогать
    await client.query(
      `UPDATE supplier_orders
          SET tender_status = $2,
              tender_results = COALESCE($3::jsonb, tender_results),
              tender_last_error = NULL,
              tender_next_poll_at = CASE WHEN $4::boolean THEN NULL ELSE tender_next_poll_at END,
              updated_at = now()
        WHERE id = $1`,
      [lot.id, t.status, results ? JSON.stringify(results) : null, nextPoll === null],
    );
    // Подтверждённая отмена внешнего тендера — освобождаем остаток (лот → cancelled).
    if (lot.sourcing_status === 'cancel_pending' && t.status === 'cancelled') {
      await client.query(`UPDATE supplier_orders SET sourcing_status = 'cancelled', row_version = row_version + 1 WHERE id = $1`, [lot.id]);
      await appendOrderAudit(client, { orderId: lot.id, action: 'tender_cancelled', projectId: lot.project_id });
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [lot.id]);
      for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, null);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Сетевой опрос одного лота: getTender (обрабатывает и 'draft'), затем результаты при
 * published/awaiting_results/finished. Бросает при недоступности интеграции/сети — poller ставит бэкофф.
 */
export async function refreshTenderLot(fastify: FastifyInstance, orderId: string): Promise<void> {
  const tc = getTenderClient();
  if (!tc) throw new TenderNotConfiguredError();
  const { rows } = await fastify.pool.query<LotRow>(
    `SELECT id, tender_portal_id, sourcing_status, tender_status, project_id
       FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
    [orderId],
  );
  const lot = rows[0];
  if (!lot || !lot.tender_portal_id) return;

  const t = await tc.getTender(lot.tender_portal_id);
  let results: TenderResultsDto | null = null;
  if (['published', 'awaiting_results', 'finished'].includes(t.status)) {
    try {
      results = await tc.getTenderResults(lot.tender_portal_id);
    } catch (e) {
      // Результаты ещё не готовы (404/409) — не ошибка; прочее пробрасываем.
      if (!(e instanceof TenderApiError) || (e.httpStatus !== 404 && e.httpStatus !== 409)) throw e;
    }
  }
  await applyState(fastify, lot, t, results);
}
