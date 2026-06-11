import type { AiJob, AiJobSourceKind, CreateAiJobInput } from '@estimat/shared';
import { api } from './api';

// Клиент API ИИ-извлечения работ/материалов из РД (таблица ai_jobs).

export interface AiJobListItem {
  id: string;
  estimate_id: string;
  source_kind: AiJobSourceKind;
  source_ref: string | null;
  status: AiJob['status'];
  error: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export function createAiJob(input: CreateAiJobInput) {
  return api.post<{ data: AiJob }>('/ai/jobs', input);
}

export function getAiJob(id: string) {
  return api.get<{ data: AiJob }>(`/ai/jobs/${id}`);
}

export function listAiJobs(estimateId: string) {
  return api.get<{ data: AiJobListItem[] }>(`/ai/jobs?estimateId=${encodeURIComponent(estimateId)}`);
}

export function applyAiJob(id: string) {
  return api.post<{ data: { works: number; materials: number } }>(`/ai/jobs/${id}/apply`);
}

// Получить распознанный markdown документа РД (для источника rd_document).
export function getRdMarkdown(nodeId: string) {
  return api.get<{ content: string }>(`/rd/documents/${nodeId}/markdown`);
}
