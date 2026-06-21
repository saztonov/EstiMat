/**
 * Realtime-шина изменений сметы поверх Postgres LISTEN/NOTIFY.
 *
 * Публикация (`publishEstimateChanged`) делается из роутов после COMMIT обычным запросом
 * `pg_notify` через пул. Доставку слушает отдельное долгоживущее соединение (см. plugins/realtime.ts),
 * которое раздаёт события подписчикам реестра. LISTEN/NOTIFY развязывает источник события и
 * WS-реестр и готовит к выносу части работы (ai-job) в отдельный процесс.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  REALTIME_PROTOCOL_VERSION,
  type EstimateChangedEvent,
  type EstimateChangeReason,
} from '@estimat/shared';

export const ESTIMATE_CHANGED_CHANNEL = 'estimate_changed';

interface MakeEventInput {
  estimateId: string;
  projectId?: string | null;
  reason: EstimateChangeReason;
  actorUserId: string | null;
  correlationId?: string | null;
  auditLogId?: string | null;
}

// Сборка события с серверными полями (eventId/changedAt/версия протокола).
export function makeEstimateEvent(input: MakeEventInput): EstimateChangedEvent {
  return {
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    eventId: randomUUID(),
    estimateId: input.estimateId,
    projectId: input.projectId ?? null,
    reason: input.reason,
    actorUserId: input.actorUserId,
    changedAt: new Date().toISOString(),
    correlationId: input.correlationId ?? null,
    auditLogId: input.auditLogId ?? null,
  };
}

// Опубликовать событие. NOTIFY-payload ограничен ~8 КБ — наш payload мал.
export async function publishEstimateChanged(pool: Pool, event: EstimateChangedEvent): Promise<void> {
  await pool.query('SELECT pg_notify($1, $2)', [ESTIMATE_CHANGED_CHANNEL, JSON.stringify(event)]);
}

type Sender = (event: EstimateChangedEvent) => void;

// Реестр локальных подписчиков (WS-соединений) по estimateId.
export class RealtimeRegistry {
  private readonly byEstimate = new Map<string, Set<Sender>>();

  subscribe(estimateId: string, send: Sender): () => void {
    let set = this.byEstimate.get(estimateId);
    if (!set) {
      set = new Set();
      this.byEstimate.set(estimateId, set);
    }
    set.add(send);
    return () => {
      const s = this.byEstimate.get(estimateId);
      if (!s) return;
      s.delete(send);
      if (s.size === 0) this.byEstimate.delete(estimateId);
    };
  }

  dispatch(event: EstimateChangedEvent): void {
    const set = this.byEstimate.get(event.estimateId);
    if (!set) return;
    for (const send of set) {
      try {
        send(event);
      } catch {
        /* отказ одного получателя не должен ронять рассылку */
      }
    }
  }
}
