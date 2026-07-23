import type { VorContentFacets } from '@estimat/shared';

// Контекст заявки на материалы: по какому ВОР и договору она заведена. Связь выводится, а не
// хранится: позиции заявки → строки сметы (material_request_item_sources) → строки ВОР. Показываем
// ТЕКУЩИЕ реквизиты договора, а не снимок на момент заявки: номер и дата правятся в «Назначении
// подрядчика», и в реестре ВОР и в заявке они обязаны выглядеть одинаково.

/** Строка выборки «ВОР объекта + договор подрядчика заявки» (как приходит из БД). */
export interface VorContextRow {
  vorId: string;
  vorName: string;
  /** Пусто, если подрядчика назначили до реестра договоров: ВОР известен, реквизитов нет. */
  contractNumber: string | null;
  contractDate: string | null;
  /** Есть ли у ВОР строки, из которых собрана эта заявка (точная/восстановленная связь позиций). */
  fromItems: boolean;
  facets: VorContentFacets;
}

export interface RequestVorContext {
  /**
   * 'items'   — ВОР найдены по строкам заявки;
   * 'estimate' — связи нет (старые заявки с link_resolution = 'unresolved'), поэтому показываем
   *              ВОР, связанные с подрядчиком договором, — иначе поповер был бы пуст.
   */
  matched: 'items' | 'estimate';
  vors: VorContextRow[];
}

/**
 * Выбрать, что показывать: связанные со строками заявки ВОР либо фолбэк «все договоры подрядчика
 * по объекту». Полнота покрытия позиций сюда не входит — её отдаёт отдельный признак
 * hasUnlinkedItems: у заявки часть позиций может быть связана, часть нет.
 */
export function pickRequestVors(rows: VorContextRow[]): RequestVorContext {
  const linked = rows.filter((r) => r.fromItems);
  return linked.length > 0 ? { matched: 'items', vors: linked } : { matched: 'estimate', vors: rows };
}
