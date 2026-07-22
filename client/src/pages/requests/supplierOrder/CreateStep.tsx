import { useMemo, useState } from 'react';
import { Modal, Select, Radio, Spin, Alert, App } from 'antd';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { round4 } from '../requestConstants';
import { OrderScheduleEditor } from '../OrderScheduleEditor';
import { orderNumberOf } from './orderHeader';
import { validateOrderSchedule, type OrderScheduleValue, type ScheduleMeta } from '../orderSchedule';
import {
  capacitiesOf, aggregateScheduleLines, prefillFromRows, mergeSchedulePrefill, normalizeSchedule,
  distributeToRequestItems,
} from '../orderDistribution';
import type { Su10MaterialRow, SupplierLotRow, SupplierOrderDetail } from '../types';

/**
 * Шаг создания: количества в заказ (частично из нескольких заявок) + новый или существующий заказ.
 * Количество задаёт ГРАФИК — раскладку по позициям заявок считает orderDistribution.
 */
export function CreateStep({
  projectId, rows, onCancel, onCreated,
}: { projectId: string; rows: Su10MaterialRow[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [orderId, setOrderId] = useState<string | undefined>();
  const [schedule, setSchedule] = useState<OrderScheduleValue[]>([]);
  const [meta, setMeta] = useState<ScheduleMeta>({ incomplete: [], excluded: [] });
  // Идентификатор идемпотентности живёт всё время окна: раньше он генерировался внутри mutationFn,
  // и повтор после сетевого таймаута создавал ВТОРОЙ заказ вместо повторной записи того же.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const ordersQ = useQuery({
    queryKey: ['supplier-lots', 'forming', projectId],
    queryFn: () => api.get<{ data: SupplierLotRow[] }>(`/supplier-orders?projectId=${projectId}&status=forming`),
  });

  // Дозаказ: нужен текущий состав заказа. Сервер сверяет график по ВСЕМУ заказу и пишет позиции
  // абсолютным количеством, поэтому без этих данных дозаказ либо ловил 400, либо затирал объём.
  const appendId = mode === 'existing' ? orderId : undefined;
  const orderQ = useQuery({
    queryKey: ['supplier-order', appendId],
    queryFn: () => api.get<{ data: SupplierOrderDetail }>(`/supplier-orders/${appendId}`),
    enabled: !!appendId,
  });
  const existing = appendId ? orderQ.data?.data : undefined;

  const selectedIds = useMemo(() => new Set(rows.map((r) => r.request_item_id)), [rows]);

  /** Уже размещённое ЭТИМИ ЖЕ позициями — переносится в отправляемое количество. */
  const carryByItemId = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of existing?.items ?? []) {
      if (it.request_item_id && selectedIds.has(it.request_item_id)) {
        m.set(it.request_item_id, (m.get(it.request_item_id) ?? 0) + Number(it.quantity));
      }
    }
    return m;
  }, [existing, selectedIds]);

  /** Размещённое ЧУЖИМИ позициями заказа: их не перезаписываем, но график обязан их покрыть. */
  const baseByAggKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of existing?.items ?? []) {
      if (!it.request_item_id || !selectedIds.has(it.request_item_id)) {
        m.set(it.agg_key, (m.get(it.agg_key) ?? 0) + Number(it.quantity));
      }
    }
    return m;
  }, [existing, selectedIds]);

  const caps = useMemo(() => capacitiesOf(rows, carryByItemId), [rows, carryByItemId]);
  const scheduleLines = useMemo(
    () => aggregateScheduleLines(rows, caps, baseByAggKey),
    [rows, caps, baseByAggKey],
  );
  const nameOf = (aggKey: string) => scheduleLines.find((l) => l.aggKey === aggKey)?.name ?? 'материал';

  // Предзаполнение: график заявки по новым позициям, поверх уже сохранённого графика заказа.
  const initialSchedule = useMemo(() => {
    const fresh = prefillFromRows(rows, caps);
    if (!existing?.deliverySchedule?.length) return fresh;
    const saved: Record<string, { deliveryDate: string | null; quantity: number }[]> = {};
    for (const s of existing.deliverySchedule) {
      (saved[s.agg_key] ??= []).push({ deliveryDate: s.delivery_date, quantity: Number(s.quantity) });
    }
    return mergeSchedulePrefill(saved, fresh);
  }, [rows, caps, existing]);

  // Материал одного agg_key может прийти от разных подрядчиков: график ведётся по материалу, а
  // разложение по их позициям считается автоматически — предупреждаем, чтобы это не выглядело
  // произвольным.
  const mixedContractors = useMemo(() => {
    const byKey = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = byKey.get(r.agg_key) ?? new Set<string>();
      set.add(r.contractor_id ?? '—');
      byKey.set(r.agg_key, set);
    }
    return [...byKey.values()].some((s) => s.size > 1);
  }, [rows]);

  const submit = useMutation({
    mutationFn: (payload: { items: { requestItemId: string; quantity: number }[]; deliverySchedule: OrderScheduleValue[] }) =>
      // title больше не задаётся: заказ опознаётся номером, объектом и составом. Колонка в БД
      // осталась ради названий у ранее созданных заказов (их читают экспорт КП и выбор заказа).
      api.post<{ data: { id: string } }>('/supplier-orders', {
        projectId,
        orderId: mode === 'existing' ? orderId : undefined,
        clientRequestId,
        items: payload.items,
        deliverySchedule: payload.deliverySchedule,
      }),
    onSuccess: (res) => { message.success('Заказ сформирован'); onCreated(res.data.id); },
    onError: (e: Error) => message.error(e.message),
  });

  function onOk() {
    if (mode === 'existing' && !orderId) return message.warning('Выберите заказ');
    if (appendId && orderQ.isLoading) return message.warning('Состав заказа ещё загружается');
    if (meta.incomplete.length) {
      return message.warning(`Укажите дату поставки: ${nameOf(meta.incomplete[0]!)}`);
    }
    const active = scheduleLines.filter((l) => !meta.excluded.includes(l.aggKey));
    if (!active.length) return message.warning('Все материалы исключены — заказывать нечего');

    const sched = normalizeSchedule(schedule);
    const err = validateOrderSchedule(active, sched, 'atMost');
    if (err) return message.warning(err);

    // Опуститься ниже уже размещённого чужими позициями нельзя: их UPSERT не тронет, а график
    // заменяется целиком — сервер отверг бы такой заказ сверкой суммы.
    for (const l of active) {
      const base = baseByAggKey.get(l.aggKey) ?? 0;
      const sum = sched.find((s) => s.aggKey === l.aggKey)?.entries.reduce((s2, e) => s2 + e.quantity, 0) ?? 0;
      if (base - sum > 1e-6) {
        return message.warning(`В заказе уже размещено ${round4(base)} — меньше указать нельзя: ${l.name}`);
      }
    }

    const { items, unassigned } = distributeToRequestItems(caps, sched, baseByAggKey);
    if (unassigned.length) {
      return message.warning('Количество превышает остаток по заявкам — уменьшите объём в графике');
    }
    if (!items.length) return message.warning('Укажите количество хотя бы по одному материалу');
    submit.mutate({ items, deliverySchedule: sched });
  }

  return (
    <Modal
      open title="Заказ поставщику — график поставок"
      width="80vw" style={{ maxWidth: 1600, top: 40 }}
      styles={{ body: { height: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      onCancel={onCancel} onOk={onOk} okText="Создать заказ" confirmLoading={submit.isPending}
    >
      <Radio.Group
        value={mode} onChange={(e) => setMode(e.target.value)} style={{ marginBottom: 12 }} optionType="button"
        options={[{ value: 'new', label: 'Новый заказ' }, { value: 'existing', label: 'Добавить в существующий' }]}
      />
      {mode === 'existing' && (
        <Select
          placeholder="Выберите формируемый заказ" style={{ width: '100%', marginBottom: 12 }}
          value={orderId} onChange={setOrderId} loading={ordersQ.isLoading}
          options={(ordersQ.data?.data ?? []).map((l) => ({
            value: l.id,
            // Хвост с названием оставлен ради заказов, созданных до отказа от этого поля: без него
            // у них пропал бы единственный человекочитаемый признак.
            label: `${orderNumberOf(l.order_no)} · ${l.items_count} поз. · ${l.requests_count} заявк.${l.title ? ` · ${l.title}` : ''}`,
          }))}
          notFoundContent="Формируемых заказов нет"
        />
      )}
      {mixedContractors && (
        <Alert
          type="info" showIcon style={{ marginBottom: 8 }}
          message="Материал заявлен несколькими подрядчиками — объём распределится между их позициями автоматически, начиная с ближайших дат поставки."
        />
      )}
      {appendId && !existing ? (
        // Редактор монтируем только с полными данными: своё состояние он синхронизирует по набору
        // материалов, и подгрузка ёмкостей «под ним» не дошла бы до уже созданных строк графика.
        <div style={{ padding: 32, textAlign: 'center' }}><Spin tip="Загружаем состав заказа" /></div>
      ) : (
        <OrderScheduleEditor
          // Смена заказа меняет ёмкости и предзаполнение — состояние графика начинается заново.
          key={appendId ?? 'new'}
          lines={scheduleLines}
          initial={initialSchedule}
          onChange={(v, m) => { setSchedule(v); setMeta(m); }}
          allowPartial
          totalLabel="Остаток по заявке"
          tableScrollY="calc(70vh - 300px)"
        />
      )}
    </Modal>
  );
}
