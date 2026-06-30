import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Идентификаторы колонок workspace и секций справочника
export type PanelId = 'smeta' | 'refs' | 'ai';
export type RefSectionId = 'rd' | 'works' | 'mat';

interface WorkspaceLayoutState {
  // Какие области включены (Смета всегда вкл — здесь не хранится)
  visibility: { ai: boolean; refs: boolean };
  // ИИ развёрнут в колонку (true) или свёрнут в рельс (false)
  aiExpanded: boolean;
  // Справочники развёрнуты в колонку (true) или свёрнуты в рельс (false)
  refsExpanded: boolean;
  // Размеры колонок — в процентах, по id
  colSizes: Partial<Record<PanelId, number>>;
  // Свёрнутость секций справочника (аккордеон)
  collapsedSections: Record<RefSectionId, boolean>;

  toggleArea: (area: 'ai' | 'refs') => void;
  /** Принудительно показать область (для программного раскрытия справочников). */
  showArea: (area: 'ai' | 'refs') => void;
  setAiExpanded: (v: boolean) => void;
  setRefsExpanded: (v: boolean) => void;
  setColSizes: (ids: PanelId[], sizesPx: number[]) => void;
  toggleSection: (id: RefSectionId) => void;
  /** Принудительно развернуть секцию справочника. */
  openSection: (id: RefSectionId) => void;
}

// Splitter отдаёт пиксели — храним проценты (устойчиво к ресайзу окна)
const toPercents = (px: number[]): number[] => {
  const total = px.reduce((a, b) => a + b, 0) || 1;
  return px.map((p) => Math.round((p / total) * 10000) / 100);
};

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set) => ({
      visibility: { ai: true, refs: true },
      aiExpanded: false,
      refsExpanded: true,
      colSizes: {},
      collapsedSections: { rd: true, works: false, mat: false },

      toggleArea: (area) =>
        set((s) => ({ visibility: { ...s.visibility, [area]: !s.visibility[area] } })),

      showArea: (area) =>
        set((s) => ({ visibility: { ...s.visibility, [area]: true } })),

      setAiExpanded: (v) => set({ aiExpanded: v }),

      setRefsExpanded: (v) => set({ refsExpanded: v }),

      setColSizes: (ids, sizesPx) =>
        set((s) => {
          const pct = toPercents(sizesPx);
          const next = { ...s.colSizes };
          ids.forEach((id, i) => {
            if (pct[i] != null) next[id] = pct[i];
          });
          return { colSizes: next };
        }),

      toggleSection: (id) =>
        set((s) => ({
          collapsedSections: { ...s.collapsedSections, [id]: !s.collapsedSections[id] },
        })),

      openSection: (id) =>
        set((s) => ({
          collapsedSections: { ...s.collapsedSections, [id]: false },
        })),
    }),
    { name: 'estimat:workspace-layout', version: 1 },
  ),
);
