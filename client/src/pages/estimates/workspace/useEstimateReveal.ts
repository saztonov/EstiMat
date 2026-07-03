import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { CostTypeGroup } from '../components/types';
import { useEstimateSelectionStore } from '../../../store/estimateSelectionStore';
import { useEstimateExpandStore } from '../../../store/estimateExpandStore';
import { useLocationContextStore } from '../../../store/locationContextStore';
import { NO_CATEGORY } from './useSmetaFilters';

// Навигация к работе из ИИ-чата: раскрыть категорию/вид, снять фильтры, выделить и прокрутить.
export function useEstimateReveal({
  groups,
  setCategoryFilter,
  setTypeFilter,
  setOnlyUnreconciled,
  setCollapsedCats,
}: {
  groups: CostTypeGroup[];
  setCategoryFilter: (v?: string) => void;
  setTypeFilter: (v?: string) => void;
  setOnlyUnreconciled: (v: boolean) => void;
  setCollapsedCats: Dispatch<SetStateAction<Set<string>>>;
}): void {
  const selectWork = useEstimateSelectionStore((s) => s.selectWork);
  const estimateReveal = useEstimateSelectionStore((s) => s.estimateRevealRequest);

  useEffect(() => {
    if (!estimateReveal) return;
    const id = estimateReveal.itemId;
    let target: { g: CostTypeGroup; description: string } | null = null;
    for (const g of groups) {
      const w = g.works.find((x) => x.id === id);
      if (w) { target = { g, description: w.description }; break; }
    }
    if (!target) return;
    const catKey = target.g.costCategoryId ?? NO_CATEGORY;
    const tKey = target.g.costTypeId ?? NO_CATEGORY;
    setCategoryFilter(undefined);
    setTypeFilter(undefined);
    setOnlyUnreconciled(false);
    // Снимаем и локационный фильтр — иначе скрытая им строка не отрисуется и scrollIntoView не сработает.
    useLocationContextStore.getState().clearFilter();
    setCollapsedCats((prev) => { if (!prev.has(catKey)) return prev; const n = new Set(prev); n.delete(catKey); return n; });
    useEstimateExpandStore.getState().expandType(tKey);
    selectWork(id, target.description, {
      costTypeId: target.g.costTypeId,
      costTypeName: target.g.costTypeName,
      costCategoryId: target.g.costCategoryId,
      costCategoryName: target.g.costCategoryName,
    });
    const scrollToRow = () =>
      document.querySelector('.estimat-row-selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => {
      scrollToRow();
      // Повторный проход после кадра: высоты ленивых placeholder’ов материалов могли сместить позицию.
      requestAnimationFrame(scrollToRow);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateReveal?.nonce]);
}
