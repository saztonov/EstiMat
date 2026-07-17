/**
 * Журнал обмена с моделью по заданиям группировки.
 *
 * Тонкая обёртка над общим журналом (lib/llm/call-log): модель зовут три контура — группировка,
 * извлечение из РД и чат, — и журнал у них общий (таблица ai_llm_calls, миграция 0065). Здесь
 * подставляется единственное, чем группировка отличается: её родитель — всегда задание.
 *
 * Обёртка нужна, чтобы run.ts не переписывался ради обобщения: у него 13 точек вызова, и правка
 * рабочего расчёта не должна ехать в одном заходе с новой административной вкладкой.
 */
import type { FastifyInstance } from 'fastify';
import {
  closeDanglingLlmCalls,
  finishLlmCall,
  markLlmCall,
  startLlmCall,
  type CallStatus,
  type LlmCallFinish,
  type ParseStatus,
} from '../llm/call-log.js';

export type { CallStatus, ParseStatus };
/** Итог вызова — тот же, что у общего журнала. */
export type CallFinish = LlmCallFinish;

export interface CallStart {
  jobId: string;
  attempt: number;
  kind: 'batch' | 'merge';
  batchIndex: number | null;
  partitionKey: string | null;
  linesCount: number | null;
  model: string;
}

/** Завести запись вызова. Возвращает id либо null — тогда обновления просто не пишутся. */
export function startCall(fastify: FastifyInstance, c: CallStart): Promise<string | null> {
  return startLlmCall(fastify, {
    parent: { kind: 'grouping', materialGroupingJobId: c.jobId },
    attempt: c.attempt,
    kind: c.kind,
    batchIndex: c.batchIndex,
    partitionKey: c.partitionKey,
    linesCount: c.linesCount,
    model: c.model,
  });
}

/** Отметить стадию (ожидание слота, отправка). Тексты ещё не известны. */
export function markCall(fastify: FastifyInstance, callId: string | null, status: CallStatus): Promise<void> {
  return markLlmCall(fastify, callId, status);
}

/** Закрыть запись: итог транспорта, тексты, разбор и расход токенов. */
export function finishCall(fastify: FastifyInstance, callId: string | null, f: CallFinish): Promise<void> {
  return finishLlmCall(fastify, callId, f);
}

/** Закрыть незавершённые записи задания (прогон прервали деплоем или отменой). */
export function closeDanglingCalls(fastify: FastifyInstance, jobId: string): Promise<void> {
  return closeDanglingLlmCalls(fastify, { kind: 'grouping', materialGroupingJobId: jobId });
}
