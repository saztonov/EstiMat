import type {
  AiTaskCallDetail,
  AiTaskDetail,
  AiTaskItem,
  AiTaskKind,
  AiTaskStats,
} from '@estimat/shared';
import { api } from './api';

/** Список задач всех контуров ИИ (админ). days — окно выборки. */
export function listAiTasks(days: number) {
  return api.get<{ data: AiTaskItem[] }>(`/ai-tasks?days=${days}`);
}

/**
 * Карточка задачи: сводка, ходы и журнал вызовов без текстов.
 * Таймаут выше дефолтных 20 с: у задания РД вызовов сотни.
 */
export function getAiTask(kind: AiTaskKind, id: string) {
  return api.get<{ data: AiTaskDetail }>(`/ai-tasks/${kind}/${id}`, { timeoutMs: 60_000 });
}

/** Полный текст одного вызова — грузится по раскрытию, а не со списком. */
export function getAiTaskCall(callId: string) {
  return api.get<{ data: AiTaskCallDetail }>(`/ai-tasks/calls/${callId}`, { timeoutMs: 60_000 });
}

export function getAiTaskStats(days: number) {
  return api.get<{ data: AiTaskStats }>(`/ai-tasks/stats?days=${days}`, { timeoutMs: 60_000 });
}

export function cancelAiTask(kind: AiTaskKind, id: string) {
  return api.post<{ data: { kind: AiTaskKind; id: string; status: string } }>(
    `/ai-tasks/${kind}/${id}/cancel`,
  );
}
