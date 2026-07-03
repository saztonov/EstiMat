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
  await fastify.publishEstimateChanged(
    makeEstimateEvent({ estimateId, projectId, reason, actorUserId, ...extra }),
  );
}
