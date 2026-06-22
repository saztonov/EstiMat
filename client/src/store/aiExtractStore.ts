import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiJobSourceKind } from '@estimat/shared';

// UI-состояние панели ИИ-извлечения РД по смете. Вынесено из локального useState,
// потому что Splitter пересоздаёт ИИ-колонку при скрытии справочников/сворачивании
// (ключи по индексу) — локальный стейт терялся бы вместе со статусом обработки.
// Markdown-содержимое здесь НЕ храним (большое; нужно лишь в момент создания задания).
export type ExtractMode = Extract<AiJobSourceKind, 'rd_document' | 'upload_md'>;

export interface ExtractUi {
  extractMode: ExtractMode;
  jobId: string | null;
  selectedDoc: { nodeId: string; name: string } | null; // подпись «Выбран документ»
  uploadedName: string | null; // подпись «Загружен: …»
  // jobId, для которого уже вызвали onEstimateChanged — гард от повторной инвалидации сметы на ремоунте.
  appliedNotifiedJobId: string | null;
}

export const DEFAULT_EXTRACT_UI: ExtractUi = {
  extractMode: 'rd_document',
  jobId: null,
  selectedDoc: null,
  uploadedName: null,
  appliedNotifiedJobId: null,
};

interface AiExtractState {
  byEstimate: Record<string, ExtractUi>;
  patch: (estimateId: string, partial: Partial<ExtractUi>) => void;
}

export const useAiExtractStore = create<AiExtractState>()(
  persist(
    (set) => ({
      byEstimate: {},
      patch: (estimateId, partial) =>
        set((s) => ({
          byEstimate: {
            ...s.byEstimate,
            [estimateId]: { ...DEFAULT_EXTRACT_UI, ...s.byEstimate[estimateId], ...partial },
          },
        })),
    }),
    { name: 'estimat:ai-extract', version: 1 },
  ),
);

// UI-состояние конкретной сметы с дефолтами (стабильная ссылка, если записи ещё нет).
export function useExtractUi(estimateId: string): ExtractUi {
  return useAiExtractStore((s) => s.byEstimate[estimateId] ?? DEFAULT_EXTRACT_UI);
}
