// Объединение соседних ячеек колонки «Местоположение» в блоки.
//
// Когда весь блок материалов относится к одному месту, колонка превращается в десятки копий одного
// и того же набора бейджей и читается как шум. Соседние строки с одинаковым местоположением
// показываем одной ячейкой (rowSpan), но не длиннее LOCATION_SPAN_MAX строк: иначе на длинном
// участке единственная подпись уезжает за пределы экрана и место не видно вовсе.
//
// Модуль чистый (без React и antd в рантайме) — тестируется в node:test.
import type { ColumnsType } from 'antd/es/table';

/** Максимум строк в одном объединённом блоке. */
export const LOCATION_SPAN_MAX = 12;

/** Класс объединённой ячейки — оформление в index.css. */
const BLOCK_CLASS = 'estimat-loc-block';

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
 */
export function locationRowSpans(keys: readonly string[], max: number = LOCATION_SPAN_MAX): number[] {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`locationRowSpans: max должен быть целым ≥ 1, получено ${max}`);
  }
  const spans = new Array<number>(keys.length).fill(1);
  let start = 0;
  for (let i = 1; i <= keys.length; i++) {
    if (i < keys.length && keys[i] === keys[start]) continue;
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
 * Колонки с объединением ячеек «Местоположение» под КОНКРЕТНЫЙ dataSource.
 *
 * Ключи считаются из самих строк, а не принимаются готовым массивом: индекс в onCell — это индекс
 * в dataSource таблицы, и разъехавшийся с ним список ключей молча сдвинул бы объединение.
 *
 * Годится только для таблиц без сортировки и пагинации: rowSpan привязан к порядку строк.
 */
export function withLocationSpans<T>(
  columns: ColumnsType<T>,
  rows: readonly T[],
  keyOf: (row: T) => string,
): ColumnsType<T> {
  const spans = locationRowSpans(rows.map(keyOf));
  // Остальные колонки возвращаем ссылочно — мемоизация вышестоящих компонентов не ломается.
  return columns.map((col) => {
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
        return {
          ...base,
          rowSpan,
          className: [base.className, BLOCK_CLASS].filter(Boolean).join(' '),
        };
      },
    };
  });
}
