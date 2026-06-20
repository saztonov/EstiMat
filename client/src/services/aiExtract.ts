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

// Элемент админского списка заданий (GET /ai/jobs без estimateId): + имена и итоги.
export interface AiJobAdminItem extends AiJobListItem {
  created_by_name: string | null;
  project_name: string | null;
  works_count: number | null;
  materials_count: number | null;
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

// Остановить выполняющееся задание (отмена).
export function cancelAiJob(id: string) {
  return api.post<{ data: { id: string; status: string } }>(`/ai/jobs/${id}/cancel`);
}

// Удалить запись задания (только терминальное; позиции в смете сохраняются). Только admin.
export function deleteAiJob(id: string) {
  return api.delete<{ success: boolean }>(`/ai/jobs/${id}`);
}

// Админский список всех заданий (GET /ai/jobs без estimateId).
export function listAllAiJobs() {
  return api.get<{ data: AiJobAdminItem[] }>('/ai/jobs');
}

// Получить распознанный markdown документа РД (для источника rd_document).
export function getRdMarkdown(nodeId: string) {
  return api.get<{ content: string }>(`/rd/documents/${nodeId}/markdown`);
}
