import { create } from 'zustand';

// Область подбора работ (разделы/виды), выбранная сметчиком в панели ИИ-извлечения.
// Используется одновременно: (а) для передачи в задание ai_jobs.input.sectionScope;
// (б) для сужения дерева «Наименования работ» при ручном доборе. Не персистится.
interface WorkScopeState {
  categoryIds: string[];
  costTypeIds: string[];
  setScope: (categoryIds: string[], costTypeIds: string[]) => void;
  clear: () => void;
}

export const useWorkScopeStore = create<WorkScopeState>((set) => ({
  categoryIds: [],
  costTypeIds: [],
  setScope: (categoryIds, costTypeIds) => set({ categoryIds, costTypeIds }),
  clear: () => set({ categoryIds: [], costTypeIds: [] }),
}));
