// Состояние набора заявки: черновик, ручные строки, отмена массовых действий.
//
// Вынесено из ContractorsMaterialsTab — там уже под пятьсот строк, а набор живёт своей жизнью.
//
// Актуальный черновик держим в ref, а не читаем из замыкания: тогда обработчики стабильны
// (их получают сотни кнопок групп и строк) и при этом видят свежее состояние. Побочных эффектов
// внутри updater'ов setState нет — в StrictMode они выполняются дважды.
import { useCallback, useRef, useState } from 'react';
import type { OrderMaterialRow } from './orderRow';
import {
  clearDraftFor,
  emptyDraft,
  fillDraft,
  setDraftValue,
  type DraftState,
  type FillOutcome,
} from './draftFill';

/** Глубина отмены. Снимок кладём только на массовые действия — см. ниже. */
const HISTORY_LIMIT = 20;

export function useRequestDraft() {
  const [draft, setDraftState] = useState<DraftState>(emptyDraft);
  // История — снимки ТОЛЬКО массовых действий: на каждое нажатие в InputNumber она заросла бы и
  // перестала работать ровно для того случая, ради которого нужна («один клик изменил 40 строк»).
  const [historyLength, setHistoryLength] = useState(0);
  const draftRef = useRef(draft);
  const historyRef = useRef<DraftState[]>([]);

  const apply = useCallback((next: DraftState, remember: boolean) => {
    if (remember) {
      historyRef.current = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), draftRef.current];
      setHistoryLength(historyRef.current.length);
    }
    draftRef.current = next;
    setDraftState(next);
  }, []);

  /** Массовое заполнение доли остатка по набору строк. Возвращает итог — для тоста. */
  const fill = useCallback(
    (
      rows: OrderMaterialRow[],
      ordered: Map<string, number>,
      percent: number,
      replaceManual = false,
    ): FillOutcome => {
      const outcome = fillDraft(draftRef.current, rows, ordered, percent, replaceManual);
      apply(outcome.next, true);
      return outcome;
    },
    [apply],
  );

  /** Убрать строки набора из заявки. */
  const clearFor = useCallback(
    (rows: OrderMaterialRow[]) => {
      apply(clearDraftFor(draftRef.current, rows), true);
    },
    [apply],
  );

  /** Построчная правка: помечает строку ручной, в историю не пишется. */
  const setValue = useCallback(
    (orderKey: string, v: number | null) => {
      apply(setDraftValue(draftRef.current, orderKey, v), false);
    },
    [apply],
  );

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    setHistoryLength(historyRef.current.length);
    draftRef.current = prev;
    setDraftState(prev);
  }, []);

  const reset = useCallback(() => {
    historyRef.current = [];
    setHistoryLength(0);
    draftRef.current = emptyDraft();
    setDraftState(draftRef.current);
  }, []);

  return { draft, fill, clearFor, setValue, undo, reset, canUndo: historyLength > 0 };
}
