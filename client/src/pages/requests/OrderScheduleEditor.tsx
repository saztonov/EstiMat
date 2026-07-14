import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, Table, InputNumber, DatePicker, Button, Space, Typography, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { DeliveryGantt, type GanttMaterial } from '../contractors/DeliveryGantt';

const { Text } = Typography;
const EPS = 1e-6;
const num = (v: number) => Math.round(v * 1e4) / 1e4;

// Материал заказа с общим количеством (вход редактора).
export interface OrderScheduleLine {
  aggKey: string;
  name: string;
  unit: string;
  quantity: number;
}

// График по материалу (выход редактора → тело запроса заказа/тендера).
export interface OrderScheduleValue {
  aggKey: string;
  entries: { deliveryDate: string; quantity: number }[];
}

interface Entry { date: Dayjs | null; qty: number | null }

/**
 * Проверка графика заказа перед отправкой: у каждого материала непустой график, даты не повторяются,
 * сумма по датам равна количеству материала в заказе. Возвращает текст ошибки или null.
 */
export function validateOrderSchedule(lines: OrderScheduleLine[], value: OrderScheduleValue[]): string | null {
  const byKey = new Map(value.map((v) => [v.aggKey, v.entries]));
  for (const l of lines) {
    const entries = byKey.get(l.aggKey) ?? [];
    if (!entries.length) return `Заполните график поставки: ${l.name}`;
    const dates = entries.map((e) => e.deliveryDate);
    if (new Set(dates).size !== dates.length) return `Даты поставки не должны повторяться: ${l.name}`;
    const sum = entries.reduce((s, e) => s + e.quantity, 0);
    if (Math.abs(sum - l.quantity) > EPS) {
      return `Сумма по датам (${num(sum)}) ≠ количеству (${num(l.quantity)}): ${l.name}`;
    }
  }
  return null;
}

interface Props {
  lines: OrderScheduleLine[];
  // Предзаполнение по материалу (из графика заявки/существующего графика заказа).
  initial?: Record<string, { deliveryDate: string; quantity: number }[]>;
  onChange: (value: OrderScheduleValue[]) => void;
}

/**
 * Редактор графика поставки заказа поставщику/тендера: по каждому материалу — даты и количество к
 * каждой дате (сумма = количеству в заказе). Ключ материала — agg_key. Инженер может добавлять,
 * удалять и править строки. Вкладка «График поставок» — предпросмотр диаграммой Ганта. График заявки
 * при этом не меняется. Переиспользуется в окне заказа и тендера.
 */
export function OrderScheduleEditor({ lines, initial, onChange }: Props) {
  const defaultsFor = (l: OrderScheduleLine): Entry[] => {
    const init = initial?.[l.aggKey];
    return init?.length
      ? init.map((e) => ({ date: dayjs(e.deliveryDate), qty: e.quantity }))
      : [{ date: null, qty: l.quantity }];
  };

  const [schedule, setSchedule] = useState<Map<string, Entry[]>>(() => {
    const m = new Map<string, Entry[]>();
    for (const l of lines) m.set(l.aggKey, defaultsFor(l));
    return m;
  });

  const linesSig = lines.map((l) => l.aggKey).join('|');

  // Синхронизация состава материалов (появились/убрались) с сохранением уже введённых строк.
  useEffect(() => {
    setSchedule((prev) => {
      const next = new Map<string, Entry[]>();
      for (const l of lines) next.set(l.aggKey, prev.get(l.aggKey) ?? defaultsFor(l));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesSig]);

  // Отдаём наружу валидные строки (заполнены дата и количество) при любом изменении.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const value: OrderScheduleValue[] = lines.map((l) => ({
      aggKey: l.aggKey,
      entries: (schedule.get(l.aggKey) ?? [])
        .filter((e) => e.date && (e.qty ?? 0) > 0)
        .map((e) => ({ deliveryDate: (e.date as Dayjs).format('YYYY-MM-DD'), quantity: e.qty as number })),
    }));
    onChangeRef.current(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, linesSig]);

  function mutate(key: string, fn: (entries: Entry[]) => Entry[]) {
    setSchedule((prev) => {
      const next = new Map(prev);
      next.set(key, fn(next.get(key) ?? []));
      return next;
    });
  }

  const entriesOf = (l: OrderScheduleLine) => schedule.get(l.aggKey) ?? [];
  const sumOf = (l: OrderScheduleLine) => entriesOf(l).reduce((s, e) => s + (e.qty ?? 0), 0);

  // Плоские строки (по одной на запись графика; rowSpan объединяет материал).
  const flatRows = useMemo(() => {
    const rows: { rowId: string; line: OrderScheduleLine; idx: number; count: number; entry: Entry }[] = [];
    for (const l of lines) {
      const entries = schedule.get(l.aggKey) ?? [];
      entries.forEach((entry, idx) => {
        rows.push({ rowId: `${l.aggKey}#${idx}`, line: l, idx, count: entries.length, entry });
      });
    }
    return rows;
  }, [lines, schedule]);

  const ganttMaterials: GanttMaterial[] = useMemo(
    () =>
      lines.map((l) => ({
        key: l.aggKey,
        name: l.name,
        unit: l.unit,
        totalQty: l.quantity,
        schedule: entriesOf(l)
          .filter((e) => e.date && (e.qty ?? 0) > 0)
          .map((e) => ({ date: (e.date as Dayjs).format('YYYY-MM-DD'), qty: e.qty as number })),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, schedule],
  );

  const spanCell = (r: { idx: number; count: number }) => ({ rowSpan: r.idx === 0 ? r.count : 0 });

  const columns: ColumnsType<(typeof flatRows)[number]> = [
    { title: 'Наименование', key: 'name', onCell: spanCell, render: (_, r) => r.line.name },
    { title: 'Ед.изм.', key: 'unit', width: 80, onCell: spanCell, render: (_, r) => r.line.unit },
    {
      title: 'Общее кол-во', key: 'total', width: 120, align: 'right', onCell: spanCell,
      render: (_, r) => {
        const diff = r.line.quantity - sumOf(r.line);
        return (
          <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
            <span>{num(r.line.quantity)}</span>
            {diff > EPS && <Text style={{ fontSize: 11, color: '#fa8c16' }}>остаток: {num(diff)}</Text>}
            {diff < -EPS && <Text type="danger" style={{ fontSize: 11 }}>лишнее: {num(-diff)}</Text>}
          </Space>
        );
      },
    },
    {
      title: 'Дата поставки', key: 'date', width: 180,
      render: (_, r) => (
        <DatePicker
          format="DD.MM.YYYY"
          style={{ width: 150 }}
          value={r.entry.date}
          onChange={(d) => mutate(r.line.aggKey, (es) => es.map((e, i) => (i === r.idx ? { ...e, date: d } : e)))}
        />
      ),
    },
    {
      title: 'Кол-во', key: 'qty', width: 130, align: 'right',
      render: (_, r) => (
        <InputNumber
          min={0}
          style={{ width: 110 }}
          value={r.entry.qty}
          onChange={(v) => mutate(r.line.aggKey, (es) => es.map((e, i) => (i === r.idx ? { ...e, qty: v as number | null } : e)))}
        />
      ),
    },
    {
      title: '', key: 'act', width: 80, align: 'center',
      render: (_, r) => (
        <Space size={0}>
          <Button
            type="text" size="small" icon={<PlusOutlined />} title="Добавить дату"
            onClick={() => mutate(r.line.aggKey, (es) => [...es, { date: null, qty: null }])}
          />
          {r.count > 1 && (
            <Button
              type="text" size="small" danger icon={<DeleteOutlined />} title="Удалить дату"
              onClick={() => mutate(r.line.aggKey, (es) => es.filter((_e, i) => i !== r.idx))}
            />
          )}
        </Space>
      ),
    },
  ];

  return (
    <Tabs
      items={[
        {
          key: 'materials',
          label: 'Материалы',
          children: (
            <>
              <Alert
                type="info" showIcon style={{ marginBottom: 8 }}
                message="Укажите даты поставки и количество к каждой дате. Сумма по датам должна равняться количеству материала в заказе. График заявки при этом не меняется."
              />
              <Table
                rowKey="rowId" size="small" pagination={false}
                columns={columns} dataSource={flatRows} scroll={{ x: 720, y: 360 }}
                bordered
              />
            </>
          ),
        },
        {
          key: 'gantt',
          label: 'График поставок',
          children: <DeliveryGantt materials={ganttMaterials} />,
        },
      ]}
    />
  );
}
