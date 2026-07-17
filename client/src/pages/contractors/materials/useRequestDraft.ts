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
  isNoopFill,
  setDraftValue,
  type DraftState,
  type FillOutcome,
} from './draftFill';

/** Глубина отмены. Снимок кладём только на массовые действия — см. ниже. */
const HISTORY_LIMIT = 20;

/** Запись истории: снимок + его номер, чтобы «Отменить» в тосте било по своему действию. */
interface HistoryEntry {
  id: number;
  snapshot: DraftState;
}

/** Итог массового действия вместе с номером его шага истории. */
export interface FillResult extends FillOutcome {
  /** Номер шага для undo(id); null — действие ничего не изменило и в историю не попало. */
  historyId: number | null;
}

export function useRequestDraft() {
  const [draft, setDraftState] = useState<DraftState>(emptyDraft);
  // История — снимки ТОЛЬКО массовых действий: на каждое нажатие в InputNumber она заросла бы и
  // перестала работать ровно для того случая, ради которого нужна («один клик изменил 40 строк»).
  const [historyLength, setHistoryLength] = useState(0);
  const draftRef = useRef(draft);
  const historyRef = useRef<HistoryEntry[]>([]);
  const nextIdRef = useRef(1);

  const apply = useCallback((next: DraftState, remember: boolean): number | null => {
    let id: number | null = null;
    if (remember) {
      id = nextIdRef.current++;
      historyRef.current = [
        ...historyRef.current.slice(-(HISTORY_LIMIT - 1)),
        { id, snapshot: draftRef.current },
      ];
      setHistoryLength(historyRef.current.length);
    }
    draftRef.current = next;
    setDraftState(next);
    return id;
  }, []);

  /** Массовое заполнение доли остатка по набору строк. Возвращает итог — для тоста. */
  const fill = useCallback(
    (
      rows: OrderMaterialRow[],
      ordered: Map<string, number>,
      percent: number,
      replaceManual = false,
    ): FillResult => {
      const outcome = fillDraft(draftRef.current, rows, ordered, percent, replaceManual);
      // Ничего не изменилось — в историю не пишем: иначе повторные клики вытеснят из стека
      // глубиной 20 те снимки, ради которых отмена и нужна.
      const historyId = apply(outcome.next, !isNoopFill(outcome));
      return { ...outcome, historyId };
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

  /**
   * Отменить последнее массовое действие, а с `id` — только если последним было именно оно.
   *
   * Кнопка «Отменить» живёт в тосте, а тост переживает следующее действие: без привязки к шагу
   * клик по старому тосту откатил бы чужую, более свежую заливку.
   */
  const undo = useCallback((id?: number): boolean => {
    const top = historyRef.current[historyRef.current.length - 1];
    if (!top || (id != null && top.id !== id)) return false;
    historyRef.current.pop();
    setHistoryLength(historyRef.current.length);
    draftRef.current = top.snapshot;
    setDraftState(top.snapshot);
    return true;
  }, []);

  const reset = useCallback(() => {
    historyRef.current = [];
    setHistoryLength(0);
    nextIdRef.current = 1;
    draftRef.current = emptyDraft();
    setDraftState(draftRef.current);
  }, []);

  return { draft, fill, clearFor, setValue, undo, reset, canUndo: historyLength > 0 };
}
