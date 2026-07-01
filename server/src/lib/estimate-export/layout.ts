// Раскладка листа «КП» экспортного шаблона (server/src/templates/kp-export-template.xlsx).
//
// Шаблон собран билдером scripts/estimate-export/build-kp-template.py: в исходную форму
// сметного отдела вставлена колонка «Тип» между «КОД» и «Наименование», поэтому все
// столбцы правее сдвинуты на +1. Если отдел пришлёт другую форму — правки локализованы
// здесь (буквы/номера колонок, стартовые строки, строки-образцы стилей).

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

// Первая строка динамической таблицы.
export const TABLE_START_ROW = 18;
// Первая строка сохраняемого «хвоста» (пустой спейсер → условия → квалиф. блок).
export const TAIL_START_ROW = 42;
// Сколько строк динамической зоны (таблица + ИТОГО + НДС) в шаблоне «из коробки».
export const DYN_TEMPLATE_ROWS = TAIL_START_ROW - TABLE_START_ROW; // 24

// Строки-образцы стилей в шаблоне (значения очищены билдером, оформление сохранено).
export const STYLE_ROW = {
  location: 18, // строка-локация (жирная, с подытогом)
  work: 20, //    строка-работа
  material: 21, // строка-материал
  itogo: 40, //   строка ИТОГО
  nds: 41, //     строка «в т.ч. НДС»
} as const;

export const CODE_WORK = 'Работа';
export const CODE_MATERIAL = 'Мат';
export const ITOGO_LABEL = 'ИТОГО с НДС 22%';
export const NDS_LABEL = 'в т.ч. НДС 22%';

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
