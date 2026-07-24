// Объединение соседних ячеек колонки «Местоположение» в блоки.
//
// Когда весь блок материалов относится к одному месту, колонка превращается в десятки копий одного
// и того же набора бейджей и читается как шум. Соседние строки с одинаковым местоположением
// показываем одной ячейкой (rowSpan), но не длиннее LOCATION_SPAN_MAX строк: иначе на длинном
// участке единственная подпись уезжает за пределы экрана и место не видно вовсе.
//
// Одного объединения мало: по вертикальной границе ячейки не видно, к каким строкам относится
// подпись. Поэтому блоки ещё и чередуются фоном (белый/серый) — цвет строки и есть граница блока.
//
// Модуль чистый (без React и antd в рантайме) — тестируется в node:test. Лежит в client/src/lib,
// а не в разделе «Подрядчики»: им пользуется и общий компонент сметы CostTypeGroupBlock.
import type { ColumnsType } from 'antd/es/table';

/** Максимум строк в одном объединённом блоке. */
export const LOCATION_SPAN_MAX = 12;

/** Класс объединённой ячейки — оформление в index.css. */
const BLOCK_CLASS = 'estimat-loc-block';

/** Модификатор объединённой ячейки в «серой» полосе — фон совпадает с фоном её строк. */
const BLOCK_ALT_CLASS = 'estimat-loc-block--alt';

/** Класс строки «серой» полосы. */
const STRIPE_CLASS = 'estimat-loc-stripe';

/** Ключ колонки местоположения — общий для всех таблиц с этой колонкой. */
const LOCATION_COLUMN_KEY = 'location';

/**
 * Ключ визуально одинакового местоположения.
 *
 * Сравниваем ВИДИМОЕ содержимое ячейки, а не данные локаций: задача презентационная — склеить
 * ячейки, которые выглядят одинаково. Строгий ключ по id зон и этажам дал бы разрывы без видимой
 * причины (набор [эт. 1-3] + [эт. 4-5] и набор [эт. 1-5] рисуются одинаково — «эт. 1-5»), а
 * пользователь прочитал бы такой разрыв как сбой. Точная разбивка по локациям осталась там, где и
 * была, — в окне детализации по клику на имя материала.
 *
 * Наборы сортируем: порядок в zoneNames/typeLabels наследует порядок вхождений работ-источников,
 * а один и тот же набор зон обязан слиться. JSON.stringify вместо символов-разделителей — в
 * названии зоны может встретиться что угодно.
 */
export function locationBadgeKey(parts: {
  zoneNames: readonly string[];
  floorsLabel: string;
  typeLabels: readonly string[];
}): string {
  return JSON.stringify([[...parts.zoneNames].sort(), parts.floorsLabel, [...parts.typeLabels].sort()]);
}

/**
 * rowSpan по индексу строки: размер блока у первой строки блока и 0 у продолжений (antd не рисует
 * ячейку с rowSpan 0). Объединяются только ПОДРЯД идущие строки с одинаковым ключом — тот же
 * ключ после разрыва начинает новый блок.
 *
 * `isBoundaryAfter(i)` — принудительная граница ПОСЛЕ строки i: блок закрывается на ней, даже если
 * следующая строка того же места. Нужно там, где после строки antd вставляет отдельный <tr>
 * (раскрытые материалы работы): объединение, «перепрыгивающее» через такой <tr>, ломает вёрстку,
 * поэтому раскрытая работа обязана быть последней строкой своего блока.
 */
export function locationRowSpans(
  keys: readonly string[],
  max: number = LOCATION_SPAN_MAX,
  isBoundaryAfter?: (index: number) => boolean,
): number[] {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`locationRowSpans: max должен быть целым ≥ 1, получено ${max}`);
  }
  const spans = new Array<number>(keys.length).fill(1);
  let start = 0;
  for (let i = 1; i <= keys.length; i++) {
    if (i < keys.length && keys[i] === keys[start] && !isBoundaryAfter?.(i - 1)) continue;
    let at = start;
    for (const size of balancedChunks(i - start, max)) {
      spans[at] = size;
      for (let j = at + 1; j < at + size; j++) spans[j] = 0;
      at += size;
    }
    start = i;
  }
  return spans;
}

/**
 * Разбить участок на блоки не длиннее max, различающиеся не более чем на строку: 13 → 7+6,
 * 26 → 9+9+8, 47 → 12+12+12+11. Деление «под завязку» дало бы огрызок (26 → 12+12+2), который
 * читается как сбой вёрстки.
 */
function balancedChunks(len: number, max: number): number[] {
  const count = Math.ceil(len / max);
  const base = Math.floor(len / count);
  const extra = len % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Полосы фона по индексу строки: true — «серая» полоса.
 *
 * Полоса переключается на СМЕНЕ местоположения, а не на границе объединённой ячейки: длинный
 * участок locationRowSpans режет на несколько ячеек (26 → 9+9+8), и смена цвета внутри него
 * читалась бы как новое место. Первая полоса всегда белая (false) — счёт начинается заново в
 * каждой таблице, то есть в каждой группе или виде работ. Принудительная граница блока (раскрытые
 * материалы) на полосу не влияет — место то же, цвет обязан остаться прежним.
 */
export function locationStripes(keys: readonly string[]): boolean[] {
  const out = new Array<boolean>(keys.length).fill(false);
  let alt = false;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] !== keys[i - 1]) alt = !alt;
    out[i] = alt;
  }
  return out;
}

/** Колонки с объединённой ячейкой местоположения и rowClassName с полосами. */
export interface LocationBlocks<T> {
  columns: ColumnsType<T>;
  /** Готовый rowClassName таблицы: полоса блока + внешний класс строки. */
  rowClassName: (row: T, index: number) => string;
}

/**
 * Разметка блоков местоположения под КОНКРЕТНЫЙ dataSource: объединение соседних ячеек колонки
 * «Местоположение» и чередование фона строк по блокам.
 *
 * Ключи считаются из самих строк, а не принимаются готовым массивом: индекс в onCell — это индекс
 * в dataSource таблицы, и разъехавшийся с ним список ключей молча сдвинул бы объединение.
 *
 * `isBoundaryAfter(i)` — принудительно завершить блок после строки i (см. locationRowSpans).
 *
 * Годится только для таблиц без сортировки и пагинации: rowSpan привязан к порядку строк.
 */
export function withLocationBlocks<T>(
  columns: ColumnsType<T>,
  rows: readonly T[],
  keyOf: (row: T) => string,
  rowClass?: (row: T) => string,
  isBoundaryAfter?: (index: number) => boolean,
): LocationBlocks<T> {
  const keys = rows.map(keyOf);
  const spans = locationRowSpans(keys, LOCATION_SPAN_MAX, isBoundaryAfter);
  const stripes = locationStripes(keys);
  // Колонки местоположения нет — объединять и размечать полосами нечего: чередование без видимого
  // признака выглядело бы случайным.
  const hasLocation = columns.some(
    (col) => 'key' in col && col.key === LOCATION_COLUMN_KEY && !('children' in col),
  );
  // Остальные колонки возвращаем ссылочно — мемоизация вышестоящих компонентов не ломается.
  const out = columns.map((col) => {
    if (!('key' in col) || col.key !== LOCATION_COLUMN_KEY || 'children' in col) return col;
    const prev = 'onCell' in col ? col.onCell : undefined;
    return {
      ...col,
      onCell: (record: T, index?: number) => {
        const base = prev?.(record, index) ?? {};
        // index необязателен по типу antd; без него сказать, какая это строка, нельзя — оставляем
        // обычную ячейку, а не спан первой строки блока.
        if (index === undefined) return base;
        const rowSpan = spans[index] ?? 1;
        if (rowSpan <= 1) return { ...base, rowSpan };
        const alt = stripes[index] ? BLOCK_ALT_CLASS : '';
        return {
          ...base,
          rowSpan,
          className: [base.className, BLOCK_CLASS, alt].filter(Boolean).join(' '),
        };
      },
    };
  });

  return {
    columns: out,
    rowClassName: (row: T, index: number) =>
      [hasLocation && stripes[index] ? STRIPE_CLASS : '', rowClass?.(row) ?? '']
        .filter(Boolean)
        .join(' '),
  };
}
