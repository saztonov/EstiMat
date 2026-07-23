import { useEffect, useRef } from 'react';

/**
 * Начальное состояние дерева сметы при входе: категории и виды работ видны, наименования работ
 * свёрнуты. На больших сметах раскрытые таблицы работ и не читаются, и дорого стоят — содержимое
 * свёрнутого вида не строится вовсе (см. CostTypeGroupBlock).
 *
 * Срабатывает один раз на смету — как только пришли группы. Дальше состояние принадлежит
 * пользователю (ручные развороты не откатываются), а переход на другую смету включает правило
 * заново. Используется и страницей «Смета» (estimateExpandStore), и вкладкой «Смета» раздела
 * «Подрядчики» (локальный state) — правило одно, поэтому и код один.
 */
export function useInitialCollapsedTypes({
  estimateId,
  typeKeys,
  enabled = true,
  onCollapse,
}: {
  estimateId: string;
  /** Ключи видов работ сметы (typeKeyOf(costTypeId)). */
  typeKeys: string[];
  /** false — целевой переход (строки договора): сворачивать нельзя, пришли смотреть строки. */
  enabled?: boolean;
  onCollapse: (keys: Set<string>) => void;
}): void {
  const doneRef = useRef<string | null>(null);
  useEffect(() => {
    if (doneRef.current === estimateId || typeKeys.length === 0) return;
    // Правило отрабатывает на смету один раз — даже когда вход был целевым и сворачивать нельзя:
    // иначе снятый позже отбор договора неожиданно свернул бы уже открытые работы.
    doneRef.current = estimateId;
    if (!enabled) return;
    onCollapse(new Set(typeKeys));
  }, [estimateId, typeKeys, enabled, onCollapse]);
}
