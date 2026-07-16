import { useMemo } from 'react';
import { buildMaterialGroups } from '../../estimates/materials/aggregateMaterials';
import type { EstimateItem } from '../../estimates/components/types';
import type { ZoneIndex } from '../../estimates/components/location';
import { buildCategoryIndex, buildOrderRows } from './orderRow';
import { useOrderedSummary } from './useOrderedSummary';

/**
 * Сводка по объекту для шапки страницы: сколько всего материальных позиций, сколько из них уже
 * заказывали и сколько заявок создано.
 *
 * Считается по всей доступной пользователю смете и НЕ зависит от отборов вкладки: это постоянный
 * ориентир в шапке, а не итог текущей выборки. Масштабирование по доле подрядчика на число
 * позиций не влияет, поэтому здесь оно не нужно.
 */
export function useMaterialsSummary(
  estimateId: string,
  items: EstimateItem[],
  viewerIsContractor: boolean,
  zoneIndex: ZoneIndex,
) {
  const { ordered, requestCount } = useOrderedSummary(estimateId, viewerIsContractor);

  const rows = useMemo(() => {
    const groups = buildMaterialGroups(items, []);
    return buildOrderRows(groups, buildCategoryIndex(items), zoneIndex);
  }, [items, zoneIndex]);

  const orderedPositions = useMemo(
    () => rows.filter((r) => (ordered.get(r.orderKey) ?? 0) > 0).length,
    [rows, ordered],
  );

  return { positions: rows.length, orderedPositions, requestCount };
}
