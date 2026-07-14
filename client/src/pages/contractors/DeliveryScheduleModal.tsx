import { useMemo, useState } from 'react';
import { Modal, Tabs, Table, InputNumber, DatePicker, Checkbox, Button, Space, Typography, Alert, App } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { type Dayjs } from 'dayjs';
import { DeliveryGantt, type GanttMaterial } from './DeliveryGantt';

const { Text } = Typography;
const EPS = 1e-6;
const num = (v: number) => Math.round(v * 1e4) / 1e4;

// Материал заявки с общим количеством (вход модалки — из введённых подрядчиком объёмов).
export interface ScheduleLineInput {
  costTypeId: string | null;
  aggKey: string;
  materialId: string | null;
  name: string;
  unit: string;
  quantity: number;
}

// Строка заявки с графиком поставки (выход модалки → тело запроса создания заявки).
export interface ScheduledLine extends ScheduleLineInput {
  deliverySchedule: { deliveryDate: string; quantity: number }[];
}

interface Props {
  open: boolean;
  lines: ScheduleLineInput[];
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (lines: ScheduledLine[]) => void;
}

interface Entry { date: Dayjs | null; qty: number | null }

const rowKey = (costTypeId: string | null, aggKey: string) => `${costTypeId ?? ''}|${aggKey}`;

/**
 * График поставки для заявки «Закупка через СУ-10»: по каждому материалу указываются даты поставки
 * и количество к каждой дате (сумма = общему количеству). В шапке — «Единая дата поставки» (одна дата
 * на всю заявку). Вкладка «График поставки» — предпросмотр диаграммой Ганта.
 */
export function DeliveryScheduleModal({ open, lines, loading, onCancel, onConfirm }: Props) {
  const { message } = App.useApp();
  const [singleDate, setSingleDate] = useState(false);
  const [commonDate, setCommonDate] = useState<Dayjs | null>(null);
  // Ключ материала → записи графика. По умолчанию одна запись на полное количество.
  const [schedule, setSchedule] = useState<Map<string, Entry[]>>(() => {
    const m = new Map<string, Entry[]>();
    for (const l of lines) m.set(rowKey(l.costTypeId, l.aggKey), [{ date: null, qty: l.quantity }]);
    return m;
  });

  const entriesOf = (l: ScheduleLineInput) => schedule.get(rowKey(l.costTypeId, l.aggKey)) ?? [];

  function mutate(key: string, fn: (entries: Entry[]) => Entry[]) {
    setSchedule((prev) => {
      const next = new Map(prev);
      next.set(key, fn(next.get(key) ?? []));
      return next;
    });
  }

  // Плоские строки таблицы (по одной на запись графика; rowSpan объединяет материал).
  const flatRows = useMemo(() => {
    const rows: { rowId: string; line: ScheduleLineInput; idx: number; count: number; entry: Entry }[] = [];
    for (const l of lines) {
      const entries = schedule.get(rowKey(l.costTypeId, l.aggKey)) ?? [];
      const list = singleDate ? entries.slice(0, 1) : entries;
      list.forEach((entry, idx) => {
        rows.push({ rowId: `${rowKey(l.costTypeId, l.aggKey)}#${idx}`, line: l, idx, count: list.length, entry });
      });
    }
    return rows;
  }, [lines, schedule, singleDate]);

  const sumOf = (l: ScheduleLineInput) => entriesOf(l).reduce((s, e) => s + (e.qty ?? 0), 0);

  // Предпросмотр Ганта из текущего состояния.
  const ganttMaterials: GanttMaterial[] = useMemo(
    () =>
      lines.map((l) => {
        const entries = singleDate
          ? commonDate
            ? [{ date: commonDate.format('YYYY-MM-DD'), qty: l.quantity }]
            : []
          : entriesOf(l)
              .filter((e) => e.date && (e.qty ?? 0) > 0)
              .map((e) => ({ date: (e.date as Dayjs).format('YYYY-MM-DD'), qty: e.qty as number }));
        return { key: rowKey(l.costTypeId, l.aggKey), name: l.name, unit: l.unit, totalQty: l.quantity, schedule: entries };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, schedule, singleDate, commonDate],
  );

  const spanCell = (r: { idx: number; count: number }) => ({ rowSpan: r.idx === 0 ? r.count : 0 });

  const columns: ColumnsType<(typeof flatRows)[number]> = [
    { title: 'Наименование', key: 'name', onCell: spanCell, render: (_, r) => r.line.name },
    { title: 'Ед.изм.', key: 'unit', width: 80, onCell: spanCell, render: (_, r) => r.line.unit },
    {
      title: 'Общее кол-во', key: 'total', width: 120, align: 'right', onCell: spanCell,
      render: (_, r) => {
        const diff = singleDate ? 0 : r.line.quantity - sumOf(r.line);
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
      render: (_, r) =>
        singleDate ? (
          <Text type="secondary">{commonDate ? commonDate.format('DD.MM.YYYY') : '— единая дата —'}</Text>
        ) : (
          <DatePicker
            format="DD.MM.YYYY"
            style={{ width: 150 }}
            value={r.entry.date}
            onChange={(d) =>
              mutate(rowKey(r.line.costTypeId, r.line.aggKey), (es) =>
                es.map((e, i) => (i === r.idx ? { ...e, date: d } : e)),
              )
            }
          />
        ),
    },
    {
      title: 'Кол-во', key: 'qty', width: 130, align: 'right',
      render: (_, r) =>
        singleDate ? (
          <span>{num(r.line.quantity)}</span>
        ) : (
          <InputNumber
            min={0}
            style={{ width: 110 }}
            value={r.entry.qty}
            onChange={(v) =>
              mutate(rowKey(r.line.costTypeId, r.line.aggKey), (es) =>
                es.map((e, i) => (i === r.idx ? { ...e, qty: v as number | null } : e)),
              )
            }
          />
        ),
    },
    {
      title: '', key: 'act', width: 80, align: 'center',
      render: (_, r) => {
        if (singleDate) return null;
        const key = rowKey(r.line.costTypeId, r.line.aggKey);
        return (
          <Space size={0}>
            <Button
              type="text" size="small" icon={<PlusOutlined />} title="Добавить дату"
              onClick={() => mutate(key, (es) => [...es, { date: null, qty: null }])}
            />
            {r.count > 1 && (
              <Button
                type="text" size="small" danger icon={<DeleteOutlined />} title="Удалить дату"
                onClick={() => mutate(key, (es) => es.filter((_e, i) => i !== r.idx))}
              />
            )}
          </Space>
        );
      },
    },
  ];

  function buildAndValidate(): ScheduledLine[] | null {
    if (singleDate) {
      if (!commonDate) {
        message.warning('Укажите единую дату поставки');
        return null;
      }
      const d = commonDate.format('YYYY-MM-DD');
      return lines.map((l) => ({ ...l, deliverySchedule: [{ deliveryDate: d, quantity: l.quantity }] }));
    }
    const result: ScheduledLine[] = [];
    for (const l of lines) {
      const entries = entriesOf(l);
      if (entries.length === 0 || entries.some((e) => !e.date || !e.qty || e.qty <= 0)) {
        message.warning(`Заполните даты и количества: ${l.name}`);
        return null;
      }
      const dates = entries.map((e) => (e.date as Dayjs).format('YYYY-MM-DD'));
      if (new Set(dates).size !== dates.length) {
        message.warning(`Даты поставки не должны повторяться: ${l.name}`);
        return null;
      }
      const sum = entries.reduce((s, e) => s + (e.qty as number), 0);
      if (Math.abs(sum - l.quantity) > EPS) {
        message.warning(`Сумма по датам (${num(sum)}) ≠ общему количеству (${num(l.quantity)}): ${l.name}`);
        return null;
      }
      result.push({
        ...l,
        deliverySchedule: entries.map((e) => ({
          deliveryDate: (e.date as Dayjs).format('YYYY-MM-DD'),
          quantity: e.qty as number,
        })),
      });
    }
    return result;
  }

  function onOk() {
    const built = buildAndValidate();
    if (built) onConfirm(built);
  }

  return (
    <Modal
      open={open}
      title="График поставки материалов"
      width="80vw"
      onCancel={onCancel}
      onOk={onOk}
      okText="Подтвердить заявку"
      confirmLoading={loading}
      destroyOnClose
    >
      <Space style={{ marginBottom: 12 }} align="center">
        <Checkbox checked={singleDate} onChange={(e) => setSingleDate(e.target.checked)}>
          Единая дата поставки
        </Checkbox>
        {singleDate && (
          <DatePicker
            format="DD.MM.YYYY"
            style={{ width: 180 }}
            value={commonDate}
            onChange={setCommonDate}
            placeholder="Дата поставки"
          />
        )}
      </Space>
      <Tabs
        items={[
          {
            key: 'materials',
            label: 'Материалы',
            children: (
              <>
                {!singleDate && (
                  <Alert
                    type="info" showIcon style={{ marginBottom: 8 }}
                    message="Для каждого материала укажите даты поставки и количество к каждой дате. Сумма по датам должна равняться общему количеству."
                  />
                )}
                <Table
                  rowKey="rowId" size="small" pagination={false}
                  columns={columns} dataSource={flatRows} scroll={{ x: 720, y: 380 }}
                  bordered
                />
              </>
            ),
          },
          {
            key: 'gantt',
            label: 'График поставки',
            children: <DeliveryGantt materials={ganttMaterials} />,
          },
        ]}
      />
    </Modal>
  );
}
