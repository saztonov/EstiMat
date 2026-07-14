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

interface LotRow {
  id: string;
  tender_portal_id: string | null;
  sourcing_status: string;
  tender_status: string | null;
  tender_remote_revision: number | null;
  project_id: string | null;
}

// Применить снимок состояния тендера к лоту (транзакция). Инварианты:
//   • revision-guard: устаревший снимок (revision меньше сохранённого) не применяется;
//   • 'finished' считаем терминальным ТОЛЬКО когда есть исход (winner/outcome) — иначе держим
//     'awaiting_results' и продолжаем опрос (портал уже перевёл в under_review/closed, но результаты
//     ещё не готовы);
//   • подтверждённая отмена (cancel_pending → портал 'cancelled') освобождает остаток (лот → cancelled);
//   • тендер завершён без победителя (outcome='no_award') → терминальный no_award, остаток освобождён.
async function applyState(fastify: FastifyInstance, lot: LotRow, t: TenderDto, results: TenderResultsDto | null): Promise<void> {
  // Устаревший снимок при параллельном опросе/ручном обновлении — не откатываем состояние.
  if (t.revision != null && lot.tender_remote_revision != null && t.revision < lot.tender_remote_revision) return;

  const hasOutcome = !!(results && (results.winner || results.outcome === 'no_award' || results.outcome === 'awarded'));
  const localStatus = t.status === 'finished' && !hasOutcome ? 'awaiting_results' : t.status;
  const terminal = localStatus === 'finished' || localStatus === 'cancelled';
  const isNoAward = localStatus === 'finished' && results?.outcome === 'no_award';

  const client = await fastify.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE supplier_orders
          SET tender_status = $2,
              tender_results = COALESCE($3::jsonb, tender_results),
              tender_remote_revision = GREATEST(COALESCE(tender_remote_revision, -1), COALESCE($4::int, -1)),
              tender_deadline_at = COALESCE($5::timestamptz, tender_deadline_at),
              tender_last_error = NULL,
              tender_next_poll_at = CASE WHEN $6::boolean THEN NULL ELSE tender_next_poll_at END,
              updated_at = now()
        WHERE id = $1`,
      [lot.id, localStatus, results ? JSON.stringify(results) : null, t.revision ?? null, t.deadline_at ?? null, terminal],
    );
    // Подтверждённая отмена внешнего тендера — освобождаем остаток (лот → cancelled).
    if (lot.sourcing_status === 'cancel_pending' && localStatus === 'cancelled') {
      await client.query(`UPDATE supplier_orders SET sourcing_status = 'cancelled', row_version = row_version + 1 WHERE id = $1`, [lot.id]);
      await appendOrderAudit(client, { orderId: lot.id, action: 'tender_cancelled', projectId: lot.project_id });
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [lot.id]);
      for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, null);
    }
    // Тендер завершён без победителя — терминальный no_award, освобождаем остаток.
    if (isNoAward && lot.sourcing_status === 'sourcing') {
      await client.query(`UPDATE supplier_orders SET sourcing_status = 'no_award', row_version = row_version + 1 WHERE id = $1`, [lot.id]);
      await appendOrderAudit(client, { orderId: lot.id, action: 'tender_no_award', projectId: lot.project_id });
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
    `SELECT id, tender_portal_id, sourcing_status, tender_status, tender_remote_revision, project_id
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
