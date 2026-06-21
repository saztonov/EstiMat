import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Активная сессия чата на смету (чтобы переживала сворачивание панели/перезагрузку).
// Сами сообщения тянет TanStack Query из БД — историю здесь не дублируем.
interface AiChatState {
  activeSessionByEstimate: Record<string, string | null>;
  setActiveSession: (estimateId: string, sessionId: string | null) => void;
}

export const useAiChatStore = create<AiChatState>()(
  persist(
    (set) => ({
      activeSessionByEstimate: {},
      setActiveSession: (estimateId, sessionId) =>
        set((s) => ({
          activeSessionByEstimate: { ...s.activeSessionByEstimate, [estimateId]: sessionId },
        })),
    }),
    { name: 'estimat:ai-chat', version: 1 },
  ),
);
