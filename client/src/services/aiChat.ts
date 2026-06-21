import type {
  ChatSession,
  ChatMessage,
  AiChatApplyInput,
  ApplySectionInput,
  ApplyResult,
  SectionScopeInput,
} from '@estimat/shared';
import { api } from './api';

export function listChatSessions(estimateId: string) {
  return api.get<{ data: ChatSession[] }>(
    `/ai-chat/sessions?estimateId=${encodeURIComponent(estimateId)}`,
  );
}

export function createChatSession(estimateId: string) {
  return api.post<{ data: ChatSession }>('/ai-chat/sessions', { estimateId });
}

export function getChatMessages(sessionId: string) {
  return api.get<{ data: ChatMessage[] }>(`/ai-chat/sessions/${sessionId}/messages`);
}

export function sendChatMessage(sessionId: string, content: string, sectionScope?: SectionScopeInput) {
  return api.post<{ data: { user: ChatMessage; assistant: ChatMessage } }>(
    `/ai-chat/sessions/${sessionId}/messages`,
    { content, sectionScope },
  );
}

export function cancelChatTurn(messageId: string) {
  return api.post<{ data: { id: string; status: string } }>(`/ai-chat/messages/${messageId}/cancel`);
}

export function applySelected(input: AiChatApplyInput) {
  return api.post<{ data: ApplyResult }>('/ai-chat/apply', input);
}

export function applySection(input: ApplySectionInput) {
  return api.post<{ data: ApplyResult }>('/ai-chat/apply-section', input);
}

export function deleteChatSession(sessionId: string) {
  return api.delete<{ success: boolean }>(`/ai-chat/sessions/${sessionId}`);
}
