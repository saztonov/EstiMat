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
  // Размеры колонок и секций — в процентах, по id
  colSizes: Partial<Record<PanelId, number>>;
  refSectionSizes: Partial<Record<RefSectionId, number>>;
  // Свёрнутость секций справочника
  collapsedSections: Record<RefSectionId, boolean>;

  toggleArea: (area: 'ai' | 'refs') => void;
  setAiExpanded: (v: boolean) => void;
  setColSizes: (ids: PanelId[], sizesPx: number[]) => void;
  setRefSectionSizes: (ids: RefSectionId[], sizesPx: number[]) => void;
  setCollapsedSections: (ids: RefSectionId[], collapsed: boolean[]) => void;
}

// Splitter отдаёт пиксели — храним проценты (устойчиво к ресайзу окна)
const toPercents = (px: number[]): number[] => {
  const total = px.reduce((a, b) => a + b, 0) || 1;
  return px.map((p) => Math.round((p / total) * 1000) / 10);
};

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set) => ({
      visibility: { ai: true, refs: true },
      aiExpanded: false,
      colSizes: {},
      refSectionSizes: {},
      collapsedSections: { rd: true, works: false, mat: false },

      toggleArea: (area) =>
        set((s) => ({ visibility: { ...s.visibility, [area]: !s.visibility[area] } })),

      setAiExpanded: (v) => set({ aiExpanded: v }),

      setColSizes: (ids, sizesPx) =>
        set((s) => {
          const pct = toPercents(sizesPx);
          const next = { ...s.colSizes };
          ids.forEach((id, i) => {
            if (pct[i] != null) next[id] = pct[i];
          });
          return { colSizes: next };
        }),

      setRefSectionSizes: (ids, sizesPx) =>
        set((s) => {
          const pct = toPercents(sizesPx);
          const next = { ...s.refSectionSizes };
          ids.forEach((id, i) => {
            if (pct[i] != null) next[id] = pct[i];
          });
          return { refSectionSizes: next };
        }),

      setCollapsedSections: (ids, collapsed) =>
        set((s) => {
          const next = { ...s.collapsedSections };
          ids.forEach((id, i) => {
            next[id] = !!collapsed[i];
          });
          return { collapsedSections: next };
        }),
    }),
    { name: 'estimat:workspace-layout', version: 1 },
  ),
);
