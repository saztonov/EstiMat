import { api } from './api';
import type { LlmConnectionResponse, LlmModelsResponse, UpdateLlmConnectionInput } from '@estimat/shared';

// Сервер моделей LM Studio (раздел «Сервер моделей» в Администрировании).
// Токен сервера хранится в env и через API не передаётся.

export function getLlmConnection() {
  return api.get<LlmConnectionResponse>('/llm/connection');
}

export function updateLlmConnection(body: UpdateLlmConnectionInput) {
  return api.put<LlmConnectionResponse>('/llm/connection', body);
}

/** Последний сохранённый каталог моделей (readonly). */
export function getLlmModels() {
  return api.get<LlmModelsResponse>('/llm/models');
}

/** Живой запрос к серверу: обновляет и сохраняет каталог. */
export function refreshLlmModels() {
  return api.post<LlmModelsResponse>('/llm/models/refresh');
}
