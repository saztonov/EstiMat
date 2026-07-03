import { startTransition, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { CostTypeGroup } from '../components/types';
import { useEstimateExpandStore, typeKeyOf } from '../../../store/estimateExpandStore';
import { NO_CATEGORY } from './useSmetaFilters';

// Поэтапное сворачивание/разворачивание дерева сметы. Уровни (снаружи внутрь):
// категории → виды работ → работы → материалы. Каждое нажатие двигает на один уровень,
// ориентируясь на текущее состояние (без счётчика — устойчиво к ручным кликам по строкам).
export function useExpandSteps({
  groups,
  collapsedCats,
  setCollapsedCats,
}: {
  groups: CostTypeGroup[];
  collapsedCats: Set<string>;
  setCollapsedCats: Dispatch<SetStateAction<Set<string>>>;
}): { expandStep: () => void; collapseStep: () => void } {
  const allCatKeys = useMemo(() => groups.map((g) => g.costCategoryId ?? NO_CATEGORY), [groups]);
  const allTypeKeys = useMemo(() => groups.map((g) => typeKeyOf(g.costTypeId)), [groups]);
  const workIdsWithMaterials = useMemo(
    () => groups.flatMap((g) => g.works.filter((w) => (w.materials?.length ?? 0) > 0).map((w) => w.id)),
    [groups],
  );

  // Состояние раскрытия/свёрнутости видов читаем императивно из store (getState), а не подпиской —
  // иначе одиночный разворот работы снова ререндерил бы весь SmetaPanel. Массовую установку
  // раскрытых работ деферим через startTransition: клик отзывается мгновенно, а монтаж/демонтаж
  // материалов идёт прерываемой работой (плюс ленивый рендер не монтирует невидимые таблицы).
  const collapseStep = useCallback(() => {
    const st = useEstimateExpandStore.getState();
    if (workIdsWithMaterials.some((id) => st.expandedWorkIds.has(id))) {
      startTransition(() => st.setExpandedWorkIds(new Set()));
    } else if (allTypeKeys.some((k) => !st.collapsedTypes.has(k))) {
      st.setCollapsedTypes(new Set(allTypeKeys));
    } else if (allCatKeys.some((k) => !collapsedCats.has(k))) {
      setCollapsedCats(new Set(allCatKeys));
    }
  }, [workIdsWithMaterials, allTypeKeys, allCatKeys, collapsedCats, setCollapsedCats]);

  const expandStep = useCallback(() => {
    const st = useEstimateExpandStore.getState();
    if (allCatKeys.some((k) => collapsedCats.has(k))) {
      setCollapsedCats(new Set());
    } else if (allTypeKeys.some((k) => st.collapsedTypes.has(k))) {
      st.setCollapsedTypes(new Set());
    } else if (workIdsWithMaterials.some((id) => !st.expandedWorkIds.has(id))) {
      startTransition(() => st.setExpandedWorkIds(new Set(workIdsWithMaterials)));
    }
  }, [allCatKeys, allTypeKeys, workIdsWithMaterials, collapsedCats, setCollapsedCats]);

  return { expandStep, collapseStep };
}
