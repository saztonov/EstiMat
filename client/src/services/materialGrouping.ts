import type {
  CreateGroupingJobInput,
  GroupingCallDetail,
  GroupingCallsResponse,
  GroupingJob,
  LatestGroupingJobResponse,
} from '@estimat/shared';
import { api } from './api';

export type { LatestGroupingJobResponse } from '@estimat/shared';

/** Группировка одна на смету: ни отбор по подрядчикам, ни настройки пользователя на неё не влияют. */
export function getLatestGroupingJob(estimateId: string) {
  return api.get<LatestGroupingJobResponse>(
    `/material-grouping/jobs/latest?${new URLSearchParams({ estimateId }).toString()}`,
  );
}

export function getGroupingJob(id: string) {
  return api.get<{ data: GroupingJob }>(`/material-grouping/jobs/${id}`);
}

/** «Пересчитать» — только у администратора (сервер тоже это проверяет). */
export function createGroupingJob(body: CreateGroupingJobInput) {
  return api.post<{ data: GroupingJob }>('/material-grouping/jobs', body);
}

export function cancelGroupingJob(id: string) {
  return api.post<{ data: GroupingJob }>(`/material-grouping/jobs/${id}/cancel`);
}

/** Журнал обмена с моделью — только у администратора. Без текстов: список поллится. */
export function getGroupingCalls(jobId: string) {
  return api.get<GroupingCallsResponse>(`/material-grouping/jobs/${jobId}/calls`);
}

/** Полный запрос и ответ одного вызова — грузится по раскрытию строки. */
export function getGroupingCall(jobId: string, callId: string) {
  return api.get<{ data: GroupingCallDetail }>(`/material-grouping/jobs/${jobId}/calls/${callId}`);
}
