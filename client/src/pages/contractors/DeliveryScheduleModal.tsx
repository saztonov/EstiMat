import { useMemo, useState } from 'react';
import {
  Modal,
  Tabs,
  Table,
  InputNumber,
  DatePicker,
  Checkbox,
  Button,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Alert,
  App,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { type Dayjs } from 'dayjs';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { DeliveryGantt, type GanttMaterial } from './DeliveryGantt';
import { GroupCard } from './materials/GroupCard';
import { smartBlocks, standardBlocks, type MaterialBlock } from './materials/materialBlocks';
import type { MaterialLevelSettings } from './materials/materialTree';
import type { OrderMaterialRow } from './materials/orderRow';
import { groupingFallbackNotice } from './materials/smartGroupingText';
import { useSmartGroupingJob } from './materials/useSmartGrouping';

const { Text } = Typography;
const EPS = 1e-6;
const num = (v: number) => Math.round(v * 1e4) / 1e4;

/** Блок материалов: шапка с датой на всю группу и таблица построчного графика. */
function BlockCard({
  block,
  rows,
  columns,
  collapsed,
  onToggle,
  date,
  onDateChange,
  noDateCount,
  singleDate,
}: {
  block: MaterialBlock;
  rows: FlatRow[];
  columns: ColumnsType<FlatRow>;
  collapsed: boolean;
  onToggle: () => void;
  date: Dayjs | null;
  onDateChange: (d: Dayjs | null) => void;
  noDateCount: number;
  singleDate: boolean;
}) {
  return (
    <GroupCard
      collapsed={collapsed}
      onToggle={onToggle}
      title={<strong style={{ fontSize: 14 }}>{block.title}</strong>}
      meta={
        <>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{block.orderKeys.length} поз.</span>
          {block.hint && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {block.hint}
            </Text>
          )}
          {!singleDate && noDateCount > 0 && <Tag color="orange">без даты · {noDateCount}</Tag>}
        </>
      }
      extra={
        // Отключена, а не скрыта: скрытая не объясняет, почему дату здесь больше не выбрать.
        <Tooltip title={singleDate ? 'Действует единая дата поставки' : 'Дата поставки на весь блок'}>
          <DatePicker
            size="small"
            format="DD.MM.YYYY"
            style={{ width: 150 }}
            placeholder="Дата на блок"
            disabled={singleDate}
            value={date}
            onChange={onDateChange}
          />
        </Tooltip>
      }
    >
      <Table<FlatRow>
        rowKey="rowId"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 720 }}
      />
    </GroupCard>
  );
}

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
  /** Смета — для умной группировки: ключ запроса общий с панелью вкладки. */
  estimateId: string;
  /** Подрядчик scope умной группировки (заявка всегда от одного подрядчика). */
  contractorId: string | null;
  /**
   * Полный свод заявки — ИСТОЧНИК ГРУППИРОВКИ (категория, вид работ, ключи ИИ-групп), но не
   * количеств: их берём из lines, там доля заявки, а не сметный объём.
   */
  rows: OrderMaterialRow[];
  /** Уровни стандартной группировки — из состояния вкладки: свой useMaterialLevels писал бы в тот
   *  же localStorage, и вкладка о правке не узнала бы. */
  levels: MaterialLevelSettings;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (lines: ScheduledLine[]) => void;
}

interface Entry { date: Dayjs | null; qty: number | null }

/** Строка таблицы блока: одна запись графика одного материала. */
interface FlatRow { rowId: string; line: ScheduleLineInput; idx: number; count: number; entry: Entry }

const rowKey = (costTypeId: string | null, aggKey: string) => `${costTypeId ?? ''}|${aggKey}`;

/**
 * График поставки для заявки «Закупка через СУ-10»: по каждому материалу указываются даты поставки
 * и количество к каждой дате (сумма = общему количеству). В шапке — «Единая дата поставки» (одна дата
 * на всю заявку). Вкладка «График поставки» — предпросмотр диаграммой Ганта.
 *
 * Материалы идут блоками той же группировки, что и вкладка «Материалы»: даты назначают комплектом
 * работы, а не перебором сорока строк подряд.
 *
 * Окно монтируется условно (`{scheduleModal && …}`), поэтому состояние графика собирается заново
 * под каждый новый набор строк. Если заменить это на постоянно смонтированное окно с `open`, даты
 * прошлой заявки переживут закрытие.
 */
export function DeliveryScheduleModal({ open, lines, estimateId, contractorId, rows, levels, loading, onCancel, onConfirm }: Props) {
  const { message } = App.useApp();
  const [singleDate, setSingleDate] = useState(false);
  const [commonDate, setCommonDate] = useState<Dayjs | null>(null);
  // Свой ключ, не общий со вкладкой: вкладка под окном уже смонтирована и о правке не узнает.
  const [view, setView] = usePersistedTab('estimat:delivery-schedule-view', 'standard');
  const smart = view === 'smart';
  // Своё состояние свёрнутости на режим: ключи листьев дерева и ИИ-групп из разных пространств.
  const [collapsedStandard, setCollapsedStandard] = useState<Set<string>>(new Set());
  const [collapsedSmart, setCollapsedSmart] = useState<Set<string>>(new Set());
  const smartJob = useSmartGroupingJob(estimateId, contractorId, smart && !!contractorId);
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

  // Плоские строки таблицы (по одной на запись графика; rowSpan объединяет материал) — по ключу
  // материала: таблицу теперь строит каждый блок из своих строк.
  const flatByKey = useMemo(() => {
    const map = new Map<string, FlatRow[]>();
    for (const l of lines) {
      const key = rowKey(l.costTypeId, l.aggKey);
      const entries = schedule.get(key) ?? [];
      const list = singleDate ? entries.slice(0, 1) : entries;
      map.set(
        key,
        list.map((entry, idx) => ({ rowId: `${key}#${idx}`, line: l, idx, count: list.length, entry })),
      );
    }
    return map;
  }, [lines, schedule, singleDate]);

  const lineByKey = useMemo(
    () => new Map(lines.map((l) => [rowKey(l.costTypeId, l.aggKey), l])),
    [lines],
  );

  // Свод полный, а заявляют не всё — группируем только строки заявки.
  const blockRows = useMemo(() => rows.filter((r) => lineByKey.has(r.orderKey)), [rows, lineByKey]);
  const smartResult = smartJob.data?.data?.result ?? null;
  const blocks = useMemo(() => {
    const base = smart ? smartBlocks(blockRows, smartResult) : standardBlocks(blockRows, levels);
    // Группировка строится по своду, а дата нужна каждой строке заявки. Если свод разойдётся с
    // набором, материал не должен исчезнуть с экрана: без даты его же отклонит валидация, и искать
    // пропажу будет негде.
    const covered = new Set(base.flatMap((b) => b.orderKeys));
    const missing = [...lineByKey.keys()].filter((k) => !covered.has(k));
    return missing.length
      ? [...base, { key: 'block:missing', title: 'Прочие материалы', orderKeys: missing }]
      : base;
  }, [smart, blockRows, smartResult, levels, lineByKey]);
  const fallbackNotice = smart ? groupingFallbackNotice(smartJob.data) : null;

  const collapsed = smart ? collapsedSmart : collapsedStandard;
  const setCollapsed = smart ? setCollapsedSmart : setCollapsedStandard;
  const toggleBlock = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Дата блока: только если у ВСЕХ его материалов ровно одна запись и дата одна — частичное
   *  состояние нельзя выдавать за общее. */
  function blockDateOf(keys: string[]): Dayjs | null {
    let common: Dayjs | null = null;
    for (const k of keys) {
      const entries = schedule.get(k) ?? [];
      if (entries.length !== 1 || !entries[0]!.date) return null;
      const d = entries[0]!.date;
      if (!common) common = d;
      else if (!common.isSame(d, 'day')) return null;
    }
    return common;
  }

  /** Дата на весь блок: одна запись на полное количество вместо текущих. Дробить количество между
   *  уже введёнными датами нечем — «дата на блок» и значит «весь объём в этот день». */
  function setBlockDate(keys: string[], date: Dayjs | null) {
    setSchedule((prev) => {
      const next = new Map(prev);
      for (const k of keys) {
        const line = lineByKey.get(k);
        if (line) next.set(k, [{ date, qty: line.quantity }]);
      }
      return next;
    });
  }

  /** Сколько материалов блока ещё без даты — иначе о пропуске узнаёшь только по отказу на
   *  «Подтвердить», возможно в свёрнутом блоке. */
  const noDateCount = (keys: string[]) =>
    keys.filter((k) => (schedule.get(k) ?? []).some((e) => !e.date)).length;

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

  const columns: ColumnsType<FlatRow> = [
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
      // Дробность поставки не проверяем: заявляемый объём сам бывает дробным при делении строки
      // между подрядчиками (1 шт на двоих → 0.5), и предупреждение висело бы на законном вводе.
      // Дробное количество в самой смете показывает тег во вкладке «Материалы».
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
                <Segmented
                  size="small"
                  style={{ marginBottom: 8 }}
                  value={view}
                  onChange={setView}
                  options={[
                    { label: 'Стандартная группировка', value: 'standard' },
                    { label: 'Умная группировка', value: 'smart' },
                  ]}
                />
                {!singleDate && (
                  <Alert
                    type="info" showIcon style={{ marginBottom: 8 }}
                    message="Укажите дату на весь блок в его шапке либо даты и количества по каждому материалу. Сумма по датам должна равняться общему количеству."
                  />
                )}
                {fallbackNotice && <Alert type="info" showIcon style={{ marginBottom: 8 }} message={fallbackNotice} />}
                {/* Скроллер общий на все блоки: у таблицы внутри карточки остаётся только
                    горизонтальный, иначе на экране было бы два вложенных вертикальных. */}
                <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
                  {smart && smartJob.isLoading ? (
                    <Spin style={{ margin: 24 }} />
                  ) : (
                    blocks.map((b) => (
                      <BlockCard
                        key={b.key}
                        block={b}
                        columns={columns}
                        rows={b.orderKeys.flatMap((k) => flatByKey.get(k) ?? [])}
                        collapsed={collapsed.has(b.key)}
                        onToggle={() => toggleBlock(b.key)}
                        date={blockDateOf(b.orderKeys)}
                        onDateChange={(d) => setBlockDate(b.orderKeys, d)}
                        noDateCount={noDateCount(b.orderKeys)}
                        singleDate={singleDate}
                      />
                    ))
                  )}
                </div>
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
