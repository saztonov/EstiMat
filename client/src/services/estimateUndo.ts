import { api } from './api';
import type { UndoPeekResponse, UndoResult } from '@estimat/shared';

// Что отменится следующим нажатием (для активности кнопки и подсказки).
export function getUndoPeek(estimateId: string) {
  return api.get<{ data: UndoPeekResponse }>(`/estimates/${estimateId}/undo/peek`);
}

// Отменить последнее своё действие в смете.
export function postUndo(estimateId: string) {
  return api.post<{ data: UndoResult }>(`/estimates/${estimateId}/undo`);
}
