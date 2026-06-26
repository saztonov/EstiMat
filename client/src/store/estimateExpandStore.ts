import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

// Состояние раскрытия дерева сметы вынесено в отдельный store, чтобы разворот/сворачивание
// одной работы или вида не каскадно ререндерили весь SmetaPanel и все блоки видов работ.
// Каждый блок подписывается ТОЛЬКО на свой узкий срез (см. useExpandedWorkKeys), поэтому
// затрагивается ровно изменившийся блок.
//
// Применяется ТОЛЬКО на странице «Смета». Другие потребители CostTypeGroupBlock
// (Подрядчики, группировка по локации) остаются на неуправляемом локальном раскрытии.

// Ключ свёрнутого вида работ. Совпадает с NO_CATEGORY ('__none__') в SmetaPanel,
// чтобы expandStep/collapseStep (ставят ключи) и блоки (читают) использовали одинаковые ключи.
export const TYPE_NONE = '__none__';
export const typeKeyOf = (costTypeId: string | null): string => costTypeId ?? TYPE_NONE;

interface EstimateExpandState {
  expandedWorkIds: Set<string>; // раскрытые работы (видны материалы)
  collapsedTypes: Set<string>; // свёрнутые виды работ (ключ = typeKeyOf(costTypeId))
  setWorkExpanded: (id: string, expanded: boolean) => void;
  setExpandedWorkIds: (ids: Set<string>) => void; // массовый разворот/сброс
  toggleType: (key: string) => void;
  setCollapsedTypes: (keys: Set<string>) => void;
  expandType: (key: string) => void; // точечно развернуть вид (reveal из ИИ)
  reset: () => void; // сброс при смене сметы
}

export const useEstimateExpandStore = create<EstimateExpandState>((set) => ({
  expandedWorkIds: new Set(),
  collapsedTypes: new Set(),
  setWorkExpanded: (id, expanded) =>
    set((s) => {
      // no-op, если значение не меняется — не плодим новый Set (иначе лишние ререндеры).
      if (expanded === s.expandedWorkIds.has(id)) return s;
      const next = new Set(s.expandedWorkIds);
      if (expanded) next.add(id);
      else next.delete(id);
      return { expandedWorkIds: next };
    }),
  setExpandedWorkIds: (ids) => set({ expandedWorkIds: ids }),
  toggleType: (key) =>
    set((s) => {
      const next = new Set(s.collapsedTypes);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { collapsedTypes: next };
    }),
  setCollapsedTypes: (keys) => set({ collapsedTypes: keys }),
  expandType: (key) =>
    set((s) => {
      if (!s.collapsedTypes.has(key)) return s;
      const next = new Set(s.collapsedTypes);
      next.delete(key);
      return { collapsedTypes: next };
    }),
  reset: () => set({ expandedWorkIds: new Set(), collapsedTypes: new Set() }),
}));

// Узкий хук-срез «какие из МОИХ работ раскрыты». useShallow сравнивает массив поэлементно,
// поэтому блок ререндерится ТОЛЬКО когда меняется раскрытие именно его работ — это сердце
// оптимизации (обычный селектор с .filter отдавал бы новый массив на любое изменение store).
export function useExpandedWorkKeys(workIds: string[]): string[] {
  return useEstimateExpandStore(useShallow((s) => workIds.filter((id) => s.expandedWorkIds.has(id))));
}
