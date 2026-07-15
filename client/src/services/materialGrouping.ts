import type { CreateGroupingJobInput, GroupingJob } from '@estimat/shared';
import { api } from './api';

/** Ответ latest: available=false — ИИ-провайдер не настроен (готовый результат всё равно отдаётся). */
export interface LatestGroupingJob {
  data: GroupingJob | null;
  available: boolean;
}

export function getLatestGroupingJob(estimateId: string, contractorIds: string[]) {
  const params = new URLSearchParams({ estimateId });
  if (contractorIds.length) params.set('contractorIds', contractorIds.join(','));
  return api.get<LatestGroupingJob>(`/material-grouping/jobs/latest?${params.toString()}`);
}

export function getGroupingJob(id: string) {
  return api.get<{ data: GroupingJob }>(`/material-grouping/jobs/${id}`);
}

export function createGroupingJob(body: CreateGroupingJobInput) {
  return api.post<{ data: GroupingJob }>('/material-grouping/jobs', body);
}

export function cancelGroupingJob(id: string) {
  return api.post<{ data: GroupingJob }>(`/material-grouping/jobs/${id}/cancel`);
}
