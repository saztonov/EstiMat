import { useQuery } from '@tanstack/react-query';
import type { ChatMessage } from '@estimat/shared';
import { getChatMessages } from '../services/aiChat';
import { useAiChatStore } from '../store/aiChatStore';

// Статус активного turn чата для тулбара-индикатора — независимо от того, смонтирована
// ли панель чата. Активная сессия берётся из aiChatStore (переживает сворачивание/перезагрузку);
// queryKey ['ai-chat-messages', sessionId] общий с панелью, поэтому запросы дедуплицируются.
export function useAiChatStatus(estimateId: string) {
  const sessionId = useAiChatStore((s) => s.activeSessionByEstimate[estimateId] ?? null);

  const { data } = useQuery({
    queryKey: ['ai-chat-messages', sessionId],
    queryFn: () => getChatMessages(sessionId as string),
    enabled: !!sessionId,
    refetchInterval: (q) =>
      (q.state.data?.data ?? []).some((m) => m.status === 'running') ? 1500 : false,
  });

  const messages: ChatMessage[] = data?.data ?? [];
  const running = messages.find((m) => m.status === 'running');
  return { busy: !!running, stepCount: running?.steps.length ?? 0 };
}
