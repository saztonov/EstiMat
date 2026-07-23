import { useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { VorMark, VorMarksMap } from '@estimat/shared';

// Отметки «В» строк сметы (в какие ВОР входит работа) вынесены в отдельный store по той же
// причине, что и состояние раскрытия (см. estimateExpandStore): раньше карта отметок лежала в
// общем объекте blockProps, а её запрос завершается уже ПОСЛЕ первой отрисовки дерева. Смена
// blockProps пробивала memo сразу у всех блоков видов работ, и дерево на 500 строк
// перерисовывалось целиком ради меток у нескольких работ.
//
// Теперь каждый блок подписан на срез по СВОИМ работам: приход отметок перерисовывает только
// те блоки, где отмеченные работы действительно есть.
//
// Применяется ТОЛЬКО на странице «Смета». Раздел «Подрядчики» передаёт карту отметок в
// CostTypeGroupBlock пропом напрямую — там своя логика видимости (у подрядчика меток нет).

interface EstimateVorMarksState {
  marks: VorMarksMap;
  setMarks: (marks: VorMarksMap) => void;
}

export const useEstimateVorMarksStore = create<EstimateVorMarksState>((set) => ({
  marks: {},
  setMarks: (marks) => set({ marks }),
}));

/**
 * Узкий срез «отметки МОИХ работ». useShallow сравнивает массив поэлементно: пока объекты
 * отметок те же (а они меняются только при перезапросе после экспорта/удаления ВОР), блок не
 * ререндерится. Возвращается Map, потому что её ждёт CostTypeGroupBlock; Map строится из уже
 * стабильного массива, поэтому её пересборка происходит ровно тогда, когда срез изменился.
 */
export function useVorMarksOf(workIds: string[]): Map<string, VorMark> {
  const ids = useEstimateVorMarksStore(useShallow((s) => workIds.filter((id) => !!s.marks[id])));
  const own = useEstimateVorMarksStore(
    useShallow((s) => workIds.map((id) => s.marks[id]).filter((m): m is VorMark => !!m)),
  );
  // useMemo обязателен: Map уходит в deps useMemo колонок таблицы, и новая ссылка на каждый
  // рендер заставляла бы пересобирать колонки впустую.
  return useMemo(() => new Map(ids.map((id, i) => [id, own[i]!])), [ids, own]);
}
