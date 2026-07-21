/**
 * Контракт графика поставки заказа. Правило «сумма по датам == количеству материала» до выделения
 * в модуль было продублировано в двух роутах дословно — тест закрепляет единственную реализацию.
 *
 * Клиент БД подменён минимальным фейком: проверяются правила, а не SQL. Достаточно того, что
 * агрегаты состава читаются одним известным запросом.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceSchedule, reconcileScheduleAfterQtyChange, type ScheduleLineInput } from './schedule.js';

type Query = { text: string; values?: unknown[] };

/** Фейк PoolClient: отдаёт заданные агрегаты состава, остальные запросы копит. */
function fakeClient(agg: { agg_key: string; qty: number }[]) {
  const queries: Query[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes('GROUP BY agg_key')) {
        return { rows: agg.map((a) => ({ agg_key: a.agg_key, qty: String(a.qty) })) };
      }
      return { rows: [] };
    },
  };
  return { client: client as never, queries };
}

/** Фейк для подгонки графика: отдаёт строки графика, копит операции над ними. */
function fakeScheduleClient(entries: { id: string; quantity: number }[]) {
  const ops: { kind: 'delete' | 'update'; id: string; delta?: number }[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      if (text.includes('SELECT id, quantity')) {
        return { rows: entries.map((e) => ({ id: e.id, quantity: String(e.quantity) })) };
      }
      if (text.startsWith('DELETE')) ops.push({ kind: 'delete', id: String(values?.[0]) });
      if (text.includes('UPDATE supplier_order_delivery_schedule')) {
        ops.push({ kind: 'update', id: String(values?.[0]), delta: Number(values?.[1]) });
      }
      return { rows: [] };
    },
  };
  return { client: client as never, ops };
}

const line = (aggKey: string, entries: [string, number][]): ScheduleLineInput => ({
  aggKey,
  entries: entries.map(([deliveryDate, quantity]) => ({ deliveryDate, quantity })),
});

test('сумма по датам должна совпасть с количеством материала в заказе', async () => {
  const { client } = fakeClient([{ agg_key: 'A', qty: 100 }]);
  const ok = await replaceSchedule(client, 'order-1', [line('A', [['2026-08-01', 60], ['2026-08-10', 40]])]);
  assert.deepEqual(ok, { ok: true });

  const { client: c2 } = fakeClient([{ agg_key: 'A', qty: 100 }]);
  const short = await replaceSchedule(c2, 'order-1', [line('A', [['2026-08-01', 60]])]);
  assert.equal(short.ok, false);
  assert.match(short.ok === false ? short.error : '', /не совпадает с количеством/);
});

test('материал вне состава заказа отклоняется', async () => {
  const { client } = fakeClient([{ agg_key: 'A', qty: 10 }]);
  const res = await replaceSchedule(client, 'order-1', [line('B', [['2026-08-01', 10]])]);
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : '', /вне состава заказа/);
});

test('повторяющиеся даты внутри материала отклоняются', async () => {
  const { client } = fakeClient([{ agg_key: 'A', qty: 20 }]);
  const res = await replaceSchedule(client, 'order-1', [line('A', [['2026-08-01', 10], ['2026-08-01', 10]])]);
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : '', /не должны повторяться/);
});

test('дробные количества не ловятся ошибкой float', async () => {
  // 0.1 + 0.2 !== 0.3 в double: без допуска SCHED_EPS этот график был бы отвергнут.
  const { client } = fakeClient([{ agg_key: 'A', qty: 0.3 }]);
  const res = await replaceSchedule(client, 'order-1', [line('A', [['2026-08-01', 0.1], ['2026-08-02', 0.2]])]);
  assert.deepEqual(res, { ok: true });
});

test('замена идёт только по переданным материалам — чужие строки не трогаются', async () => {
  const { client, queries } = fakeClient([{ agg_key: 'A', qty: 5 }, { agg_key: 'B', qty: 7 }]);
  await replaceSchedule(client, 'order-1', [line('A', [['2026-08-01', 5]])]);
  const del = queries.find((q) => q.text.includes('DELETE FROM supplier_order_delivery_schedule'));
  assert.ok(del, 'ожидалось удаление прежних строк графика');
  assert.deepEqual(del.values?.[1], ['A']);
});

// ---- Подгонка графика под новое количество (правка состава заказа) ----

test('увеличение доливается в последнюю дату', async () => {
  const { client, ops } = fakeScheduleClient([{ id: 'e1', quantity: 10 }, { id: 'e2', quantity: 5 }]);
  await reconcileScheduleAfterQtyChange(client, 'order-1', 'A', 20);
  assert.deepEqual(ops, [{ kind: 'update', id: 'e2', delta: 5 }]);
});

test('уменьшение списывается с поздних дат, ближайшая поставка не трогается', async () => {
  // Ближайшие отгрузки согласованы с поставщиком — режем хвост.
  const { client, ops } = fakeScheduleClient([{ id: 'e1', quantity: 10 }, { id: 'e2', quantity: 5 }]);
  await reconcileScheduleAfterQtyChange(client, 'order-1', 'A', 12);
  assert.deepEqual(ops, [{ kind: 'update', id: 'e2', delta: 3 }]);
});

test('обнулённые списанием строки удаляются, а не остаются с нулём', async () => {
  const { client, ops } = fakeScheduleClient([
    { id: 'e1', quantity: 10 }, { id: 'e2', quantity: 5 }, { id: 'e3', quantity: 3 },
  ]);
  await reconcileScheduleAfterQtyChange(client, 'order-1', 'A', 10);
  assert.deepEqual(ops, [{ kind: 'delete', id: 'e3' }, { kind: 'delete', id: 'e2' }]);
});

test('совпадающее количество не порождает ни одной операции', async () => {
  const { client, ops } = fakeScheduleClient([{ id: 'e1', quantity: 7 }]);
  await reconcileScheduleAfterQtyChange(client, 'order-1', 'A', 7);
  assert.deepEqual(ops, []);
});

test('без графика по материалу подгонка ничего не выдумывает', async () => {
  const { client, ops } = fakeScheduleClient([]);
  await reconcileScheduleAfterQtyChange(client, 'order-1', 'A', 42);
  assert.deepEqual(ops, []);
});
