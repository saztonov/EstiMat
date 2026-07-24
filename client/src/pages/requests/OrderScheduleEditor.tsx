import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, Table, InputNumber, DatePicker, Button, Space, Typography, Alert, Tooltip } from 'antd';
import { NumberInput } from '../../components/NumberInput';
import { PlusOutlined, DeleteOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { DeliveryGantt, type GanttMaterial } from '../contractors/DeliveryGantt';
import type { OrderScheduleLine, OrderScheduleValue, ScheduleMeta } from './orderSchedule';

const { Text } = Typography;
const EPS = 1e-6;
const num = (v: number) => Math.round(v * 1e4) / 1e4;

interface Entry { date: Dayjs | null; qty: number | null }

// Контракт графика живёт в orderSchedule.ts (чистый модуль, покрыт тестами); здесь — только UI.
// Реэкспорт оставлен, чтобы вызывающий код продолжал импортировать всё из одного места.
export { validateOrderSchedule } from './orderSchedule';
export type {
  OrderScheduleLine, OrderScheduleValue, ScheduleMeta, ScheduleSumMode,
} from './orderSchedule';

interface Props {
  lines: OrderScheduleLine[];
  // Предзаполнение по материалу (из графика заявки/существующего графика заказа).
  // deliveryDate: null — недатированный остаток: строка с пустым полем даты, её надо заполнить.
  initial?: Record<string, { deliveryDate: string | null; quantity: number }[]>;
  onChange: (value: OrderScheduleValue[], meta: ScheduleMeta) => void;
  /** Можно заказать меньше ёмкости и исключить материал из заказа (создание заказа). */
  allowPartial?: boolean;
  /** Заголовок колонки итога. */
  totalLabel?: string;
  /** Высота прокручиваемой области таблицы. */
  tableScrollY?: number | string;
}

/**
 * Редактор графика поставки заказа поставщику/тендера: по каждому материалу — даты и количество к
 * каждой дате. Ключ материала — agg_key. Инженер может добавлять, удалять и править строки.
 * Вкладка «График поставок» — предпросмотр диаграммой Ганта. График заявки при этом не меняется.
 *
 * Два режима суммы (см. ScheduleSumMode). В режиме allowPartial редактор — единственный источник
 * количества в заказе, поэтому здесь же живёт исключение материала: снять его галочкой в своде
 * уже нельзя, окно открыто.
 */
export function OrderScheduleEditor({
  lines, initial, onChange, allowPartial, totalLabel, tableScrollY,
}: Props) {
  const defaultsFor = (l: OrderScheduleLine): Entry[] => {
    const init = initial?.[l.aggKey];
    return init?.length
      ? init.map((e) => ({ date: e.deliveryDate ? dayjs(e.deliveryDate) : null, qty: e.quantity }))
      : [{ date: null, qty: l.quantity }];
  };

  const [schedule, setSchedule] = useState<Map<string, Entry[]>>(() => {
    const m = new Map<string, Entry[]>();
    for (const l of lines) m.set(l.aggKey, defaultsFor(l));
    return m;
  });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const linesSig = lines.map((l) => l.aggKey).join('|');

  // Синхронизация состава материалов (появились/убрались) с сохранением уже введённых строк.
  useEffect(() => {
    setSchedule((prev) => {
      const next = new Map<string, Entry[]>();
      for (const l of lines) next.set(l.aggKey, prev.get(l.aggKey) ?? defaultsFor(l));
      return next;
    });
    setExcluded((prev) => new Set([...prev].filter((k) => lines.some((l) => l.aggKey === k))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesSig]);

  // Отдаём наружу валидные строки (заполнены дата и количество) при любом изменении.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const value: OrderScheduleValue[] = [];
    const incomplete: string[] = [];
    for (const l of lines) {
      if (excluded.has(l.aggKey)) continue;
      const entries = schedule.get(l.aggKey) ?? [];
      // Строка «наполовину заполнена» — не молчаливый недобор, а незавершённый ввод: сообщаем
      // наружу отдельно, иначе в режиме atMost она выглядела бы как осознанное уменьшение.
      if (entries.some((e) => (!e.date && (e.qty ?? 0) > 0) || (e.date && !((e.qty ?? 0) > 0)))) {
        incomplete.push(l.aggKey);
      }
      value.push({
        aggKey: l.aggKey,
        entries: entries
          .filter((e) => e.date && (e.qty ?? 0) > 0)
          .map((e) => ({ deliveryDate: (e.date as Dayjs).format('YYYY-MM-DD'), quantity: e.qty as number })),
      });
    }
    onChangeRef.current(value, { incomplete, excluded: [...excluded] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, excluded, linesSig]);

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
    const rows: {
      rowId: string; line: OrderScheduleLine; idx: number; count: number; matIdx: number; entry: Entry;
    }[] = [];
    lines.forEach((l, matIdx) => {
      const entries = schedule.get(l.aggKey) ?? [];
      entries.forEach((entry, idx) => {
        rows.push({ rowId: `${l.aggKey}#${idx}`, line: l, idx, count: entries.length, matIdx, entry });
      });
    });
    return rows;
  }, [lines, schedule]);

  const ganttMaterials: GanttMaterial[] = useMemo(
    () =>
      lines.filter((l) => !excluded.has(l.aggKey)).map((l) => ({
        key: l.aggKey,
        name: l.name,
        unit: l.unit,
        totalQty: l.quantity,
        schedule: entriesOf(l)
          .filter((e) => e.date && (e.qty ?? 0) > 0)
          .map((e) => ({ date: (e.date as Dayjs).format('YYYY-MM-DD'), qty: e.qty as number })),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, schedule, excluded],
  );

  const spanCell = (r: { idx: number; count: number }) => ({ rowSpan: r.idx === 0 ? r.count : 0 });
  const isOff = (r: { line: OrderScheduleLine }) => excluded.has(r.line.aggKey);

  const columns: ColumnsType<(typeof flatRows)[number]> = [
    {
      title: '№', key: 'idx', width: 56, align: 'right', onCell: spanCell,
      render: (_, r) => <Text type="secondary">{r.matIdx + 1}</Text>,
    },
    {
      title: 'Наименование', key: 'name', onCell: spanCell,
      render: (_, r) => (
        <span style={isOff(r) ? { textDecoration: 'line-through', color: 'var(--est-text-quaternary)' } : undefined}>
          {r.line.name}
        </span>
      ),
    },
    { title: 'Ед.изм.', key: 'unit', width: 80, onCell: spanCell, render: (_, r) => r.line.unit },
    {
      title: totalLabel ?? 'Общее кол-во', key: 'total', width: 130, align: 'right', onCell: spanCell,
      render: (_, r) => {
        if (isOff(r)) return <Text type="secondary">исключён</Text>;
        const diff = r.line.quantity - sumOf(r.line);
        return (
          <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
            <span>{num(r.line.quantity)}</span>
            {/* При allowPartial недобор — норма (закажем позже), поэтому он нейтрального цвета. */}
            {diff > EPS && (
              <Text type="secondary" style={{ fontSize: 11, color: allowPartial ? undefined : 'var(--est-orange)' }}>
                {allowPartial ? 'не заказано' : 'остаток'}: {num(diff)}
              </Text>
            )}
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
          disabled={isOff(r)}
          value={r.entry.date}
          onChange={(d) => mutate(r.line.aggKey, (es) => es.map((e, i) => (i === r.idx ? { ...e, date: d } : e)))}
        />
      ),
    },
    {
      title: 'Кол-во', key: 'qty', width: 130, align: 'right',
      render: (_, r) => (
        <NumberInput
          preset="quantity"
          min={0}
          style={{ width: 110 }}
          disabled={isOff(r)}
          value={r.entry.qty}
          onChange={(v) => mutate(r.line.aggKey, (es) => es.map((e, i) => (i === r.idx ? { ...e, qty: v as number | null } : e)))}
        />
      ),
    },
    {
      title: '', key: 'act', width: allowPartial ? 110 : 80, align: 'center',
      render: (_, r) => {
        if (isOff(r)) {
          return r.idx === 0 ? (
            <Tooltip title="Вернуть в заказ">
              <Button type="text" size="small" icon={<UndoOutlined />}
                onClick={() => setExcluded((p) => { const n = new Set(p); n.delete(r.line.aggKey); return n; })} />
            </Tooltip>
          ) : null;
        }
        return (
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
            {allowPartial && r.idx === 0 && (
              <Tooltip title="Исключить из заказа">
                <Button type="text" size="small" icon={<StopOutlined />}
                  onClick={() => setExcluded((p) => new Set(p).add(r.line.aggKey))} />
              </Tooltip>
            )}
          </Space>
        );
      },
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
                message={allowPartial
                  ? 'Укажите даты поставки и количество к каждой дате. Заказать можно не больше остатка по заявке — недобранное останется в своде и попадёт в следующий заказ. График заявки при этом не меняется.'
                  : 'Укажите даты поставки и количество к каждой дате. Сумма по датам должна равняться количеству материала в заказе. График заявки при этом не меняется.'}
              />
              <Table
                rowKey="rowId" size="small" pagination={false}
                columns={columns} dataSource={flatRows} scroll={{ y: tableScrollY ?? 360 }}
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
