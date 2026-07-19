// Тесты чистой логики табличного ядра списковых таблиц: нормализация настроек столбцов,
// применение порядка/видимости, поколоночные отборы и generic-группировка. То, что глазом
// в таблице на сотни строк не проверить.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ColumnsType } from 'antd/es/table';
import { applyColumnPrefs, resolveColumnPrefs, type ColumnDef } from './columnPrefs';
import { applyColumnFilters, hasActiveColumnFilters, collectMultiOptions, type ColumnFilterSpec } from './columnFilters';
import { collectGroupKeys, groupRows, isGroupRow, levelsFromOrder, type GroupLevel } from './tableGrouping';

// ---------- resolveColumnPrefs ----------

const DEFS: ColumnDef[] = [
  { key: 'project', label: 'Объект', groupable: true },
  { key: 'contractor', label: 'Подрядчик', groupable: true },
  { key: 'name', label: 'Материал', required: true },
  { key: 'amount', label: 'Сумма', defaultHidden: true },
];

test('resolveColumnPrefs: нормализация старого localStorage', () => {
  // Сохранён устаревший порядок: неизвестный ключ + пропущенные новые колонки.
  const prefs = resolveColumnPrefs(DEFS, ['ghost', 'contractor', 'name'], { ghost: true });
  assert.deepEqual(prefs.order, ['contractor', 'name', 'project', 'amount']);
  assert.equal('ghost' in prefs.hidden, false);
});

test('resolveColumnPrefs: required нельзя скрыть, defaultHidden работает, явный показ перекрывает', () => {
  const prefs = resolveColumnPrefs(DEFS, DEFS.map((d) => d.key), { name: true });
  assert.equal(prefs.hidden.name, false, 'required-колонка видима даже если помечена скрытой');
  assert.equal(prefs.hidden.amount, true, 'defaultHidden скрывает по умолчанию');
  const shown = resolveColumnPrefs(DEFS, DEFS.map((d) => d.key), { amount: false });
  assert.equal(shown.hidden.amount, false, 'явное включение перекрывает defaultHidden');
});

// ---------- applyColumnPrefs ----------

interface Row { id: string }
const col = (key: string | undefined, extra: object = {}): ColumnsType<Row>[number] =>
  ({ key, title: key ?? '', ...extra }) as ColumnsType<Row>[number];

test('applyColumnPrefs: служебные ведущие слева, хвостовые справа, порядок применяется', () => {
  const cols: ColumnsType<Row> = [
    col('unread'), // ведущая служебная (до настраиваемых)
    col('project'), col('contractor'), col('name'), col('amount'),
    col('actions'), // хвостовая служебная (после настраиваемых)
  ];
  const prefs = resolveColumnPrefs(DEFS, ['contractor', 'project', 'name', 'amount'], { amount: true });
  const out = applyColumnPrefs(cols, prefs);
  assert.deepEqual(out.map((c) => c.key), ['unread', 'contractor', 'project', 'name', 'actions']);
});

test('applyColumnPrefs: fixed right остаётся только у последней колонки', () => {
  const cols: ColumnsType<Row> = [col('name'), col('project'), col('actions', { fixed: 'right' })];
  const out = applyColumnPrefs(cols, resolveColumnPrefs(DEFS, ['name', 'project'], {}));
  const actions = out.find((c) => c.key === 'actions') as { fixed?: string };
  assert.equal(actions.fixed, 'right', 'actions последняя — закрепление сохранено');
});

test('applyColumnPrefs: условно отсутствующая колонка не ломает порядок', () => {
  const cols: ColumnsType<Row> = [col('project'), col('name')]; // без contractor (условно нет)
  const out = applyColumnPrefs(cols, resolveColumnPrefs(DEFS, DEFS.map((d) => d.key), {}));
  assert.deepEqual(out.map((c) => c.key), ['project', 'name']);
});

// ---------- отборы ----------

interface MRow { name: string; type: string | null; date: string | null; qty: number | string | null }
const SPECS: Record<'name' | 'type' | 'date' | 'qty', ColumnFilterSpec<MRow>> = {
  name: { kind: 'text', getText: (r) => r.name },
  type: { kind: 'multi', getText: (r) => r.type, labelOf: (v) => v.toUpperCase() },
  date: { kind: 'dateRange', getDate: (r) => r.date },
  qty: { kind: 'numRange', getNum: (r) => r.qty },
};
const ROWS: MRow[] = [
  { name: 'Труба стальная', type: 'su10', date: '2026-07-01T10:00:00Z', qty: 5 },
  { name: 'Муфта', type: 'rp', date: '2026-07-10', qty: '12.5' },
  { name: 'Лоток', type: null, date: null, qty: null },
];

test('отборы: текст по вхождению без регистра', () => {
  const out = applyColumnFilters(ROWS, { name: { kind: 'text', value: 'труба' } }, SPECS);
  assert.deepEqual(out.map((r) => r.name), ['Труба стальная']);
});

test('отборы: множественный выбор и диапазоны', () => {
  assert.deepEqual(
    applyColumnFilters(ROWS, { type: { kind: 'multi', values: ['su10', 'rp'] } }, SPECS).map((r) => r.name),
    ['Труба стальная', 'Муфта'],
  );
  // Дата с timestamp сравнивается по календарному дню; строка без даты отсеивается.
  assert.deepEqual(
    applyColumnFilters(ROWS, { date: { kind: 'dateRange', from: '2026-07-01', to: '2026-07-05' } }, SPECS).map((r) => r.name),
    ['Труба стальная'],
  );
  // Числовое значение может прийти строкой из БД.
  assert.deepEqual(
    applyColumnFilters(ROWS, { qty: { kind: 'numRange', min: 10 } }, SPECS).map((r) => r.name),
    ['Муфта'],
  );
});

test('отборы: скрытый столбец игнорируется (скрытие снимает отбор)', () => {
  const filters = { name: { kind: 'text', value: 'труба' } as const };
  assert.equal(applyColumnFilters(ROWS, filters, SPECS, { name: true }).length, 3);
  assert.equal(hasActiveColumnFilters(filters, { name: true }), false);
  assert.equal(hasActiveColumnFilters(filters), true);
});

test('отборы: варианты multi собираются из строк с подписями', () => {
  const opts = collectMultiOptions(ROWS, SPECS.type);
  assert.deepEqual(opts, [{ value: 'rp', label: 'RP' }, { value: 'su10', label: 'SU10' }]);
});

// ---------- группировка ----------

interface GRow { id: string; project: string; contractor: string; qty: number }
const G_ROWS: GRow[] = [
  { id: 'a', project: 'П1', contractor: 'Бета', qty: 1 },
  { id: 'b', project: 'П2', contractor: 'Альфа', qty: 2 },
  { id: 'c', project: 'П1', contractor: 'Альфа', qty: 3 },
  { id: 'd', project: 'П1', contractor: 'Бета', qty: 4 },
];
const LEVEL_MAP: Record<string, GroupLevel<GRow>> = {
  project: { key: 'project', idOf: (r) => r.project, labelOf: (r) => r.project },
  contractor: { key: 'contractor', idOf: (r) => r.contractor, labelOf: (r) => r.contractor },
};

test('группировка: уровни в порядке столбцов, агрегаты и листья без потерь', () => {
  const levels = levelsFromOrder(['project', 'contractor'], ['contractor', 'project'], {}, LEVEL_MAP);
  assert.deepEqual(levels.map((l) => l.key), ['project', 'contractor'], 'порядок уровней — из order, не из порядка включения');
  const tree = groupRows(G_ROWS, levels, (items) => ({ qty: items.reduce((s, x) => s + x.qty, 0) }));
  assert.equal(tree.length, 2);
  const p1 = tree[0];
  assert.ok(isGroupRow(p1));
  assert.equal(p1.label, 'П1');
  assert.equal(p1.count, 3);
  assert.equal(p1.agg.qty, 8);
  // Второй уровень отсортирован по-русски, листья дошли без дублей и потерь.
  const subLabels = p1.children.filter(isGroupRow).map((g) => g.label);
  assert.deepEqual(subLabels, ['Альфа', 'Бета']);
  const leafIds = p1.children.filter(isGroupRow).flatMap((g) => g.items.map((i) => i.id)).sort();
  assert.deepEqual(leafIds, ['a', 'c', 'd']);
  assert.equal(collectGroupKeys(tree).length, 2 + 3, 'ключи всех узлов обоих уровней');
});

test('группировка: скрытый и неизвестный столбец не становятся уровнем', () => {
  const levels = levelsFromOrder(['project', 'contractor', 'ghost'], ['project', 'contractor', 'ghost'], { contractor: true }, LEVEL_MAP);
  assert.deepEqual(levels.map((l) => l.key), ['project']);
  assert.deepEqual(groupRows(G_ROWS, [], undefined), G_ROWS, 'без уровней — плоский список');
});
