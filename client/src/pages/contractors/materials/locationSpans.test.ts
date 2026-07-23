// Объединение ячеек колонки «Местоположение»: границы блоков и адаптер колонок.
// Глазом на смете в 577 позиций сбитый на строку rowSpan не увидеть — проверяем инвариантами.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ColumnsType } from 'antd/es/table';
import { LOCATION_SPAN_MAX, locationBadgeKey, locationRowSpans, withLocationSpans } from './locationSpans';

/** Размеры блоков в порядке следования — то, что реально видно на экране. */
const blocks = (spans: number[]) => spans.filter((s) => s > 0);

const same = (n: number, key = 'a') => Array.from({ length: n }, () => key);

// ---------- размеры блоков ----------

test('пустой список и одна строка', () => {
  assert.deepEqual(locationRowSpans([]), []);
  assert.deepEqual(locationRowSpans(['a']), [1]);
});

test('участок не длиннее максимума — один блок', () => {
  assert.deepEqual(blocks(locationRowSpans(same(LOCATION_SPAN_MAX))), [LOCATION_SPAN_MAX]);
  assert.deepEqual(locationRowSpans(same(3)), [3, 0, 0]);
});

test('длинный участок режется на равные блоки, а не под завязку с огрызком', () => {
  assert.deepEqual(blocks(locationRowSpans(same(13))), [7, 6]);
  assert.deepEqual(blocks(locationRowSpans(same(26))), [9, 9, 8], '12+12+2 читалось бы как сбой');
  assert.deepEqual(blocks(locationRowSpans(same(47))), [12, 12, 12, 11], 'случай со скриншота');
});

test('разные местоположения подряд не сливаются', () => {
  assert.deepEqual(locationRowSpans(['a', 'a', 'b', 'c', 'c', 'c']), [2, 0, 1, 3, 0, 0]);
});

test('тот же ключ после разрыва начинает новый блок', () => {
  assert.deepEqual(locationRowSpans(['a', 'a', 'b', 'a']), [2, 0, 1, 1]);
});

test('пустое местоположение — такой же блок, а не строка прочерков', () => {
  assert.deepEqual(blocks(locationRowSpans(same(5, ''))), [5]);
});

test('инварианты на произвольных данных', () => {
  const keys = [...same(47), ...same(1, 'b'), ...same(26, 'c'), ...same(13, 'd')];
  const spans = locationRowSpans(keys);
  assert.equal(spans.length, keys.length);
  assert.equal(
    spans.reduce((s, v) => s + v, 0),
    keys.length,
    'сумма спанов обязана покрыть все строки ровно один раз',
  );
  for (const size of blocks(spans)) assert.ok(size <= LOCATION_SPAN_MAX, `блок ${size} длиннее максимума`);
  // Строка-продолжение не может стоять первой, а внутри блока не может быть чужого ключа.
  let at = 0;
  for (const size of blocks(spans)) {
    for (let i = at; i < at + size; i++) assert.equal(keys[i], keys[at], 'в блок попал чужой ключ');
    at += size;
  }
});

test('некорректный максимум отклоняется', () => {
  assert.throws(() => locationRowSpans(same(3), 0));
  assert.throws(() => locationRowSpans(same(3), -1));
  assert.throws(() => locationRowSpans(same(3), 1.5));
});

// ---------- ключ местоположения ----------

test('порядок зон и типов на ключ не влияет', () => {
  const a = locationBadgeKey({ zoneNames: ['Корпус 1', 'Паркинг'], floorsLabel: '-2-15', typeLabels: ['Стены', 'Пол'] });
  const b = locationBadgeKey({ zoneNames: ['Паркинг', 'Корпус 1'], floorsLabel: '-2-15', typeLabels: ['Пол', 'Стены'] });
  assert.equal(a, b);
});

test('различие в любой части подписи разводит ключи', () => {
  const base = { zoneNames: ['Корпус 1'], floorsLabel: '1-5', typeLabels: ['Пол'] };
  assert.notEqual(locationBadgeKey(base), locationBadgeKey({ ...base, floorsLabel: '1-4' }));
  assert.notEqual(locationBadgeKey(base), locationBadgeKey({ ...base, zoneNames: ['Корпус 2'] }));
  assert.notEqual(locationBadgeKey(base), locationBadgeKey({ ...base, typeLabels: [] }));
  assert.notEqual(locationBadgeKey(base), locationBadgeKey({ ...base, zoneNames: ['Корпус 1', 'Корпус 2'] }));
});

test('служебные символы в названии зоны не склеивают разные места', () => {
  const a = locationBadgeKey({ zoneNames: ['Корпус 1", "Корпус 2'], floorsLabel: '', typeLabels: [] });
  const b = locationBadgeKey({ zoneNames: ['Корпус 1', 'Корпус 2'], floorsLabel: '', typeLabels: [] });
  assert.notEqual(a, b);
});

// ---------- адаптер колонок ----------

interface Row {
  id: string;
  place: string;
}

const rows: Row[] = [
  { id: '1', place: 'a' },
  { id: '2', place: 'a' },
  { id: '3', place: 'b' },
];
const keyOf = (r: Row) => r.place;

const cols: ColumnsType<Row> = [
  { title: 'Материал', key: 'name' },
  { title: 'Местоположение', key: 'location' },
];

/** Вызвать onCell колонки местоположения — как это делает antd при рендере строки. */
function cellOf(columns: ColumnsType<Row>, index?: number) {
  const col = columns.find((c) => 'key' in c && c.key === 'location')!;
  const onCell = 'onCell' in col ? col.onCell : undefined;
  assert.ok(onCell, 'у колонки местоположения должен появиться onCell');
  return onCell(rows[index ?? 0]!, index) as { rowSpan?: number; className?: string; style?: object };
}

test('объединяются подряд идущие строки, продолжение получает rowSpan 0', () => {
  const out = withLocationSpans(cols, rows, keyOf);
  assert.equal(cellOf(out, 0).rowSpan, 2);
  assert.equal(cellOf(out, 1).rowSpan, 0);
  assert.equal(cellOf(out, 2).rowSpan, 1, 'одиночная строка остаётся обычной ячейкой');
});

test('класс блока — только у объединённой ячейки', () => {
  const out = withLocationSpans(cols, rows, keyOf);
  assert.match(cellOf(out, 0).className ?? '', /estimat-loc-block/);
  assert.equal(cellOf(out, 2).className, undefined);
});

test('чужой onCell сохраняется, класс дописывается', () => {
  const withOwn: ColumnsType<Row> = [
    { title: 'Материал', key: 'name' },
    {
      title: 'Местоположение',
      key: 'location',
      onCell: () => ({ className: 'own', style: { color: 'red' }, rowSpan: 5 }),
    },
  ];
  const out = withLocationSpans(withOwn, rows, keyOf);
  const cell = cellOf(out, 0);
  assert.deepEqual(cell.style, { color: 'red' }, 'чужие свойства не должны теряться');
  assert.equal(cell.className, 'own estimat-loc-block');
  assert.equal(cell.rowSpan, 2, 'объединение перебивает чужой rowSpan');
});

test('без индекса ячейка остаётся обычной', () => {
  const out = withLocationSpans(cols, rows, keyOf);
  assert.equal(cellOf(out, undefined).rowSpan, undefined);
});

test('прочие колонки те же по ссылке, групповые не трогаются', () => {
  const grouped: ColumnsType<Row> = [
    ...cols,
    { title: 'Группа', key: 'location', children: [{ title: 'Вложенная', key: 'inner' }] },
  ];
  const out = withLocationSpans(grouped, rows, keyOf);
  assert.equal(out[0], grouped[0], 'колонка «Материал» не должна пересоздаваться');
  assert.equal(out[2], grouped[2], 'групповая колонка не должна получать rowSpan');
  assert.notEqual(out[1], grouped[1]);
});
