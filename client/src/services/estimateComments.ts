import { api } from './api';
import type { CommentTargetType, EstimateComment } from '@estimat/shared';

// Комментарии (примечания) к работе или виду работ в контексте сметы.
export function getComments(estimateId: string, targetType: CommentTargetType, targetId: string) {
  const p = new URLSearchParams({ targetType, targetId });
  return api.get<{ data: EstimateComment[] }>(`/estimates/${estimateId}/comments?${p.toString()}`);
}

export function addComment(
  estimateId: string,
  payload: { targetType: CommentTargetType; targetId: string; body: string },
) {
  return api.post<{ data: EstimateComment }>(`/estimates/${estimateId}/comments`, payload);
}

export function updateComment(commentId: string, body: string) {
  return api.put<{ data: EstimateComment }>(`/estimates/comments/${commentId}`, { body });
}

export function deleteComment(commentId: string) {
  return api.delete<{ success: boolean }>(`/estimates/comments/${commentId}`);
}
