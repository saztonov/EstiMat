/**
 * Эмит realtime-события об изменении сметы.
 *
 * ИНВАРИАНТ: вызывается ТОЛЬКО после COMMIT транзакции-мутации (fire-and-forget) —
 * подписчики по событию перечитывают данные, и они уже должны быть видимы.
 * Вынесен отдельно от bus.ts, чтобы не тянуть тип FastifyInstance в модуль,
 * который импортируется плагином realtime.
 */
import type { FastifyInstance } from 'fastify';
import type { EstimateChangeReason } from '@estimat/shared';
import { makeEstimateEvent } from './bus.js';

export async function emitEstimateChanged(
  fastify: Pick<FastifyInstance, 'publishEstimateChanged'>,
  reason: EstimateChangeReason,
  estimateId: string,
  projectId: string | null,
  actorUserId: string,
  extra?: { auditLogId?: string | null; correlationId?: string | null },
): Promise<void> {
  const event = makeEstimateEvent({ estimateId, projectId, reason, actorUserId, ...extra });
  // Публикуем в СЛЕДУЮЩЕМ макротике, а не сразу: вызывающий роут к этому моменту освободит
  // транзакционный client (finally client.release()), поэтому pg_notify возьмёт СВОБОДНОЕ
  // соединение пула, а не второе поверх ещё удерживаемого (иначе — deadlock при очень малом
  // пуле). Best-effort: событие информационное (подписчики перечитывают смету), ошибку
  // публикации глушим — она не должна превращаться в 500 по уже закоммиченной операции.
  setImmediate(() => {
    void fastify.publishEstimateChanged(event).catch(() => { /* best-effort: событие потеряно */ });
  });
}
