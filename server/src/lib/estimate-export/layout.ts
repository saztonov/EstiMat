// Раскладка листа «КП» экспортного шаблона (server/src/templates/kp-export-template.xlsx).
//
// Шаблон собран билдером scripts/estimate-export/build-kp-template.py из финальной формы
// сметного отдела (temp/Пример выгрузки ВОР.xlsx) — билдер лишь очищает значения динамической
// зоны, сохраняя стили. Если отдел пришлёт другую форму — правки локализованы здесь (буквы/номера
// колонок, стартовые строки, строки-образцы стилей) и в билдере.

export const KP_SHEET = 'КП';

// Колонки листа «КП» (1-indexed).
export const COL = {
  num: 1, //           A  № п/п
  code: 2, //          B  КОД (Работа/Мат)
  type: 3, //          C  Тип (location_type_name) — вставленная колонка
  name: 4, //          D  Наименование
  contractorNote: 5, // E  Примечание (комментарии) от контрагента — заполняют подрядчики
  unit: 6, //          F  Ед. изм.
  volume: 7, //        G  Объём по виду работ
  coef: 8, //          H  Общий расход по материалу (коэффициент qty_ratio)
  priceMat: 9, //      I  Цена за единицу — Материалы (пусто, заполняет подрядчик)
  priceSmr: 10, //     J  Цена за единицу — СМР/ПНР (пусто)
  priceTotal: 11, //   K  Цена за единицу ИТОГО = SUM(I:J)
  costMat: 12, //      L  Стоимость — Материалы = I*G
  costSmr: 13, //      M  Стоимость — СМР = J*G
  costTotal: 14, //    N  Общая стоимость = SUM(L:M)
  note: 15, //         O  Примечание (пусто)
} as const;

// Ширина колонки «Примечание» (O). В шаблоне она 20.29 — под комментарии сметчика хватало, но
// после добавления состава работы из справочника текст стало не прочитать. Excel показывает
// ширину примерно на 0.71 меньше значения в файле, поэтому 80.71 даёт ровно 80 в интерфейсе.
export const NOTE_COL_WIDTH = 80.71;

// Первая строка динамической таблицы.
export const TABLE_START_ROW = 18;
// Первая строка сохраняемого «хвоста» (пустой спейсер → условия → квалиф. блок).
export const TAIL_START_ROW = 46;
// Сколько строк динамической зоны (таблица + ИТОГО + НДС) в шаблоне «из коробки».
export const DYN_TEMPLATE_ROWS = TAIL_START_ROW - TABLE_START_ROW; // 28

// Строки-образцы стилей в шаблоне (значения очищены билдером, оформление сохранено).
export const STYLE_ROW = {
  location: 18, // строка-локация (жирная, с подытогом)
  work: 19, //    строка-работа
  material: 20, // строка-материал
  itogo: 44, //   строка ИТОГО
  nds: 45, //     строка «в т.ч. НДС»
} as const;

export const CODE_WORK = 'Работа';
export const CODE_MATERIAL = 'Мат';
export const ITOGO_LABEL = 'ИТОГО с НДС 22%';
export const NDS_LABEL = 'в т.ч. НДС 22%';

// Листы-справочники: МАТЕРИАЛЫ (стоимость материалов) и РАБОТЫ (стоимость работ).
// Раскладка одинакова: строка 1 — заголовок, 2 — шапка, 3 — индексы колонок, данные с строки 4,
// строка-итог (SUBTOTAL) — сразу за данными.
// Колонки: A=№ п/п, B=Наименование, C=Ед. изм., D=Объём (SUMIFS из «КП»), E=Цена (заполняет
// подрядчик), F=ИТОГО (=E*D), G=Примечание.
export const BSM_SHEET = 'МАТЕРИАЛЫ';
export const BSR_SHEET = 'РАБОТЫ';
export const REF_DATA_START_ROW = 4;
export const REF_COL = { num: 1, name: 2, unit: 3, volume: 4, price: 5, total: 6, note: 7 } as const;

// Строка-образец стиля строки-итога (SUBTOTAL) в справочнике «из коробки» — writer снимает с неё
// оформление и переносит итог под фактические данные.
export const REF_SUBTOTAL_STYLE_ROW = { materials: 15, works: 12 } as const;

// Служебный лист-якорь (very hidden): по нему загруженный обратно файл узнаётся как «этот ВОР», а
// его строки сопоставляются с работами и материалами сметы по UUID — устойчиво к тому, что
// подрядчик отсортировал, вставил или удалил строки в «КП». В старых ВОР листа нет: там
// сопоставление позиционное, по построчному снимку (см. vor-prices.ts).
// Раскладка: A1 — метка формата, B1 — версия; A2 — vorId; строка 3 — шапка; данные с 4-й:
// A = номер строки «КП», B = вид ('work' | 'material'), C = itemId, D = materialId (у работы пусто).
export const ANCHOR_SHEET = '_ESTIMAT';
export const ANCHOR_MARKER = 'ESTIMAT_VOR';
export const ANCHOR_VERSION = 1;
export const ANCHOR_DATA_START_ROW = 4;
export const ANCHOR_COL = { row: 1, kind: 2, itemId: 3, materialId: 4 } as const;

// Номер колонки → буква (1→A, 27→AA).
export function colLetter(col: number): string {
  let s = '';
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
