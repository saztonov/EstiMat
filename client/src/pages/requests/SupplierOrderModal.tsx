import { useMemo, useState } from 'react';
import {
  Modal, Steps, Tabs, Table, Button, Space, Input, InputNumber, Select, Radio, Tag, Empty, Divider,
  Popconfirm, Dropdown, Upload, Alert, Descriptions, App,
} from 'antd';
import {
  ShoppingCartOutlined, DownloadOutlined, UploadOutlined, DeleteOutlined, TrophyOutlined,
  FileExcelOutlined, MoreOutlined, PaperClipOutlined, CalendarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MANUAL_VAT_RATES, MANUAL_VAT_RATE_LABELS, MANUAL_VAT_RATE_VALUE,
  PAYMENT_TYPES, PAYMENT_TYPE_LABELS,
  OFFER_RESPONSE_STATUS_LABELS, OFFER_DOC_TYPE_LABELS,
  type ManualVatRate, type PaymentType,
} from '@estimat/shared';
import { api } from '../../services/api';
import { money, round4 } from './requestConstants';
import { DeliveryGantt, type GanttMaterial } from '../contractors/DeliveryGantt';
import { OrderScheduleEditor, validateOrderSchedule, type OrderScheduleLine, type OrderScheduleValue } from './OrderScheduleEditor';
import type { Su10MaterialRow, SupplierLotRow, SupplierOrderDetail, OrderOffer, OrderAggItem } from './types';

const RESP_COLOR: Record<string, string> = { pending: 'default', received: 'green', no_response: 'warning' };
const roundMoney = (v: number) => Math.round(v * 100) / 100;

interface Props {
  // Создание из выбранных материалов свода.
  create?: { projectId: string; rows: Su10MaterialRow[] };
  // Просмотр/оформление существующего заказа.
  orderId?: string;
  onClose: () => void;
  onChanged?: () => void;
}

export function SupplierOrderModal({ create, orderId, onClose, onChanged }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [createdId, setCreatedId] = useState<string | undefined>(orderId);
  const id = createdId;

  const invalidateOutside = () => {
    qc.invalidateQueries({ queryKey: ['su10-materials'] });
    qc.invalidateQueries({ queryKey: ['supplier-lots'] });
    qc.invalidateQueries({ queryKey: ['purchases-registry'] });
    onChanged?.();
  };

  if (!id) {
    return (
      <CreateStep
        projectId={create!.projectId}
        rows={create!.rows}
        onCancel={onClose}
        onCreated={(newId) => { setCreatedId(newId); invalidateOutside(); }}
      />
    );
  }
  return <OrderStep orderId={id} onClose={onClose} onChanged={invalidateOutside} fromMaterials={!!create} />;
}

// ============================================================
// Шаг создания: количества в заказ (частично из нескольких заявок) + новый/существующий заказ.
// ============================================================
function CreateStep({
  projectId, rows, onCancel, onCreated,
}: { projectId: string; rows: Su10MaterialRow[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [title, setTitle] = useState('');
  const [orderId, setOrderId] = useState<string | undefined>();
  const [draft, setDraft] = useState<Map<string, number>>(new Map());
  const [schedule, setSchedule] = useState<OrderScheduleValue[]>([]);

  const ordersQ = useQuery({
    queryKey: ['supplier-lots', 'forming', projectId],
    queryFn: () => api.get<{ data: SupplierLotRow[] }>(`/supplier-orders?projectId=${projectId}&status=forming`),
  });

  const rowByItemId = useMemo(() => new Map(rows.map((r) => [r.request_item_id, r])), [rows]);

  const items = useMemo(
    () => rows.map((r) => ({
      requestItemId: r.request_item_id,
      name: r.material_name,
      unit: r.unit,
      contractor: r.contractor_name ?? '—',
      remaining: r.remaining ?? 0,
      quantity: draft.get(r.request_item_id) ?? (r.remaining ?? 0),
    })),
    [rows, draft],
  );

  // Материалы графика — агрегат по agg_key; количество = сумма выбранного «В заказ».
  const scheduleLines: OrderScheduleLine[] = useMemo(() => {
    const map = new Map<string, OrderScheduleLine>();
    for (const it of items) {
      const r = rowByItemId.get(it.requestItemId);
      if (!r) continue;
      const cur = map.get(r.agg_key);
      if (cur) cur.quantity += it.quantity;
      else map.set(r.agg_key, { aggKey: r.agg_key, name: r.material_name, unit: r.unit, quantity: it.quantity });
    }
    return [...map.values()];
  }, [items, rowByItemId]);

  // Предзаполнение графиком заявки: даты строк с выбранным количеством, свёрнутые по agg_key.
  const initialSchedule = useMemo(() => {
    const acc = new Map<string, Map<string, number>>();
    for (const it of items) {
      const r = rowByItemId.get(it.requestItemId);
      if (!r || !r.delivery_date || it.quantity <= 0) continue;
      const byDate = acc.get(r.agg_key) ?? new Map<string, number>();
      byDate.set(r.delivery_date, (byDate.get(r.delivery_date) ?? 0) + it.quantity);
      acc.set(r.agg_key, byDate);
    }
    const out: Record<string, { deliveryDate: string; quantity: number }[]> = {};
    for (const [k, m] of acc) out[k] = [...m.entries()].map(([deliveryDate, quantity]) => ({ deliveryDate, quantity }));
    return out;
  }, [items, rowByItemId]);

  const submit = useMutation({
    mutationFn: () => api.post<{ data: { id: string } }>('/supplier-orders', {
      projectId,
      orderId: mode === 'existing' ? orderId : undefined,
      title: mode === 'new' ? title.trim() || undefined : undefined,
      clientRequestId: crypto.randomUUID(),
      items: items.map((it) => ({ requestItemId: it.requestItemId, quantity: it.quantity })),
      deliverySchedule: schedule,
    }),
    onSuccess: (res) => { message.success('Заказ сформирован'); onCreated(res.data.id); },
    onError: (e: Error) => message.error(e.message),
  });

  function onOk() {
    if (mode === 'existing' && !orderId) return message.warning('Выберите заказ');
    if (items.some((it) => it.quantity <= 0 || it.quantity > it.remaining + 1e-9)) {
      return message.warning('Количество должно быть в пределах остатка');
    }
    const schedErr = validateOrderSchedule(scheduleLines, schedule);
    if (schedErr) return message.warning(schedErr);
    submit.mutate();
  }

  const columns: ColumnsType<(typeof items)[number]> = [
    { title: 'Материал', dataIndex: 'name', key: 'name' },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    { title: 'Подрядчик', dataIndex: 'contractor', key: 'contractor', width: 160 },
    { title: 'Остаток', dataIndex: 'remaining', key: 'remaining', width: 90, align: 'right', render: (v: number) => round4(v) },
    {
      title: 'В заказ', key: 'qty', width: 120, align: 'right',
      render: (_, it) => (
        <InputNumber
          min={0} max={it.remaining} value={it.quantity} style={{ width: 100 }}
          onChange={(v) => setDraft((prev) => new Map(prev).set(it.requestItemId, Number(v ?? 0)))}
        />
      ),
    },
  ];

  return (
    <Modal
      open title="Заказ поставщику — состав" width={820}
      onCancel={onCancel} onOk={onOk} okText="Создать заказ" confirmLoading={submit.isPending}
    >
      <Tabs
        items={[
          {
            key: 'items',
            label: 'Состав',
            children: (
              <>
                <Radio.Group
                  value={mode} onChange={(e) => setMode(e.target.value)} style={{ marginBottom: 12 }} optionType="button"
                  options={[{ value: 'new', label: 'Новый заказ' }, { value: 'existing', label: 'Добавить в существующий' }]}
                />
                {mode === 'new' ? (
                  <Input placeholder="Название заказа (необязательно)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 12 }} />
                ) : (
                  <Select
                    placeholder="Выберите формируемый заказ" style={{ width: '100%', marginBottom: 12 }}
                    value={orderId} onChange={setOrderId} loading={ordersQ.isLoading}
                    options={(ordersQ.data?.data ?? []).map((l) => ({
                      value: l.id,
                      label: `З-${String(l.order_no ?? 0).padStart(3, '0')}${l.title ? ` · ${l.title}` : ''} (${l.items_count} поз.)`,
                    }))}
                    notFoundContent="Формируемых заказов нет"
                  />
                )}
                <Table rowKey="requestItemId" size="small" pagination={false} dataSource={items} columns={columns} scroll={{ y: 320 }} />
              </>
            ),
          },
          {
            key: 'schedule',
            label: 'График поставок',
            children: <OrderScheduleEditor lines={scheduleLines} initial={initialSchedule} onChange={setSchedule} />,
          },
        ]}
      />
    </Modal>
  );
}

// ============================================================
// Шаг заказа: этапы Состав → Поставщики → Оформление (по sourcing_status).
// ============================================================
function OrderStep({ orderId, onClose, onChanged, fromMaterials }: { orderId: string; onClose: () => void; onChanged: () => void; fromMaterials: boolean }) {
  const { message } = App.useApp();
  const [winnerLocal, setWinnerLocal] = useState<string | undefined>();
  const [vatRate, setVatRate] = useState<ManualVatRate>('vat22');
  const [paymentType, setPaymentType] = useState<PaymentType>('advance');
  const [prices, setPrices] = useState<Map<string, { price: number | null; warranty: number | null }>>(new Map());

  const orderQ = useQuery({
    queryKey: ['supplier-order', orderId],
    queryFn: () => api.get<{ data: SupplierOrderDetail }>(`/supplier-orders/${orderId}`),
  });
  const order = orderQ.data?.data;
  const refetch = () => { orderQ.refetch(); onChanged(); };

  const run = useMutation({
    mutationFn: (v: { method: 'post' | 'delete'; url: string; body?: unknown }) =>
      v.method === 'delete' ? api.delete(v.url) : api.post(v.url, v.body),
    onSuccess: () => refetch(),
    onError: (e: Error) => message.error(e.message),
  });

  if (orderQ.isLoading || !order) {
    return <Modal open title="Заказ поставщику" footer={null} onCancel={onClose}><div style={{ padding: 24 }}>Загрузка…</div></Modal>;
  }

  const number = `З-${String(order.order_no ?? 0).padStart(3, '0')}`;
  const isTender = order.procurement_method === 'tender';
  const status = order.sourcing_status;
  const stepIndex = status === 'forming' ? 0 : status === 'awarded' ? 2 : 1;

  async function freezeAndExport() {
    try {
      await api.post(`/supplier-orders/${orderId}/start`, { method: 'manual', expectedVersion: order!.row_version });
      await api.download(`/supplier-orders/${orderId}/export`, undefined, `Запрос_КП_${number}.xlsx`);
      message.success('Состав зафиксирован, запрос КП скачан');
      refetch();
    } catch (e) { message.error((e as Error).message); }
  }
  async function reExport() {
    try { await api.download(`/supplier-orders/${orderId}/export`, undefined, `Запрос_КП_${number}.xlsx`); }
    catch (e) { message.error((e as Error).message); }
  }

  const moreMenu = {
    items: [
      ...(status === 'forming'
        ? [{ key: 'del', danger: true, icon: <DeleteOutlined />, label: 'Удалить черновик' }]
        : []),
      ...(status === 'sourcing'
        ? [{ key: 'cancel', danger: true, icon: <DeleteOutlined />, label: 'Отменить закупку' }]
        : []),
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'del') {
        Modal.confirm({
          title: 'Удалить формируемый заказ?', okText: 'Удалить', okButtonProps: { danger: true },
          onOk: () => api.delete(`/supplier-orders/${orderId}`).then(() => { message.success('Заказ удалён'); onChanged(); onClose(); }).catch((e) => message.error(e.message)),
        });
      }
      if (key === 'cancel') {
        Modal.confirm({
          title: 'Отменить закупку? Остаток материалов вернётся в свод.', okText: 'Отменить', okButtonProps: { danger: true },
          onOk: () => api.post(`/supplier-orders/${orderId}/cancel`).then(() => { message.success('Закупка отменена'); onChanged(); onClose(); }).catch((e) => message.error(e.message)),
        });
      }
    },
  };

  return (
    <Modal
      open width={960} onCancel={onClose} footer={null}
      title={
        <Space>
          <span>Заказ поставщику {number}</span>
          {order.project_name && <Tag>{order.project_name}</Tag>}
          {isTender && <Tag color="blue">Тендер</Tag>}
        </Space>
      }
    >
      {!isTender && <Steps size="small" current={stepIndex} style={{ marginBottom: 16 }}
        items={[{ title: 'Состав' }, { title: 'Поставщики' }, { title: 'Оформление' }]} />}

      {/* ===== Тендер: компактный статус (read-only) ===== */}
      {isTender && (
        <TenderView order={order} onRefresh={() => run.mutate({ method: 'post', url: `/supplier-orders/${orderId}/tender-refresh` })}
          onAward={(pid) => run.mutate({ method: 'post', url: `/supplier-orders/${orderId}/award`, body: { source: 'tender', winnerParticipantId: pid, expectedVersion: order.row_version } })} />
      )}

      {/* ===== Этап «Состав» (forming): состав + запрос КП + поставщики (без приёма КП/победителя) ===== */}
      {!isTender && status === 'forming' && (
        <FormingStage
          order={order} fromMaterials={fromMaterials}
          onFreezeExport={freezeAndExport} onReExport={reExport} moreMenu={moreMenu}
          onRemoveItem={(itemId) => run.mutate({ method: 'delete', url: `/supplier-orders/${orderId}/items/${itemId}` })}
          refetch={refetch}
        />
      )}

      {/* ===== Этапы «Поставщики» + «Оформление» (sourcing) ===== */}
      {!isTender && status === 'sourcing' && (
        <SourcingStages
          order={order} number={number}
          winnerLocal={winnerLocal} setWinnerLocal={setWinnerLocal}
          vatRate={vatRate} setVatRate={setVatRate}
          paymentType={paymentType} setPaymentType={setPaymentType}
          prices={prices} setPrices={setPrices}
          onReExport={reExport} moreMenu={moreMenu} refetch={refetch} onClose={onClose}
        />
      )}

      {/* ===== Оформлен (awarded) — read-only ===== */}
      {!isTender && status === 'awarded' && <AwardedView order={order} number={number} />}

      {(status === 'cancelled' || status === 'no_award') && (
        <Alert type="warning" showIcon message="Закупка завершена без поставщика — материалы возвращены в свод" />
      )}
    </Modal>
  );
}

// ---- Этап «Состав» (forming): состав + запрос КП + добавление поставщиков ----
// Приём счетов/КП и выбор победителя здесь недоступны — только после начала сбора
// предложений (sourcing), т.е. при открытии заказа из вкладки «Заказы».
function FormingStage({
  order, fromMaterials, onFreezeExport, onReExport, moreMenu, onRemoveItem, refetch,
}: {
  order: SupplierOrderDetail; fromMaterials: boolean;
  onFreezeExport: () => void; onReExport: () => void;
  moreMenu: { items: unknown[]; onClick: (e: { key: string }) => void };
  onRemoveItem: (itemId: string) => void; refetch: () => void;
}) {
  const { message } = App.useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [schedEditOpen, setSchedEditOpen] = useState(false);
  const [schedDraft, setSchedDraft] = useState<OrderScheduleValue[]>([]);

  const offerMut = useMutation({
    mutationFn: (v: { method: 'post' | 'delete'; url: string; body?: unknown }) =>
      v.method === 'delete' ? api.delete(v.url) : api.post(v.url, v.body),
    onSuccess: () => refetch(),
    onError: (e: Error) => message.error(e.message),
  });

  // График поставки заказа: материалы (агрегаты) + предзаполнение из сохранённого графика.
  const scheduleLines: OrderScheduleLine[] = order.aggItems.map((a) => ({
    aggKey: a.agg_key, name: a.material_name, unit: a.unit, quantity: Number(a.quantity),
  }));
  const initialSchedule = useMemo(() => {
    const out: Record<string, { deliveryDate: string; quantity: number }[]> = {};
    for (const e of order.deliverySchedule ?? []) {
      (out[e.agg_key] ??= []).push({ deliveryDate: e.delivery_date, quantity: Number(e.quantity) });
    }
    return out;
  }, [order.deliverySchedule]);
  const ganttMaterials: GanttMaterial[] = order.aggItems.map((a) => ({
    key: a.agg_key, name: a.material_name, unit: a.unit, totalQty: Number(a.quantity),
    schedule: (order.deliverySchedule ?? [])
      .filter((e) => e.agg_key === a.agg_key)
      .map((e) => ({ date: e.delivery_date, qty: Number(e.quantity) })),
  }));

  const saveSchedule = useMutation({
    mutationFn: () => api.put(`/supplier-orders/${order.id}/delivery-schedule`, { schedule: schedDraft, expectedVersion: order.row_version }),
    onSuccess: () => { message.success('График сохранён'); setSchedEditOpen(false); refetch(); },
    onError: (e: Error) => message.error(e.message),
  });
  function saveSched() {
    const err = validateOrderSchedule(scheduleLines, schedDraft);
    if (err) return message.warning(err);
    saveSchedule.mutate();
  }

  const offerCols: ColumnsType<OrderOffer> = [
    {
      title: 'Поставщик', dataIndex: 'supplier_name', key: 'sn',
      render: (v, o) => <Space>{v}{o.supplier_inn ? <span style={{ color: '#8c8c8c' }}>ИНН {o.supplier_inn}</span> : null}</Space>,
    },
    { title: 'Ответ', dataIndex: 'response_status', key: 'rs', width: 170, render: (v) => <Tag color={RESP_COLOR[v]}>{OFFER_RESPONSE_STATUS_LABELS[v as keyof typeof OFFER_RESPONSE_STATUS_LABELS]}</Tag> },
    {
      title: '', key: 'act', width: 60, align: 'right',
      render: (_, o) => (
        <Popconfirm title="Убрать поставщика?" onConfirm={() => offerMut.mutate({ method: 'delete', url: `/supplier-orders/${order.id}/offers/${o.id}` })}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <Tabs
        items={[
          {
            key: 'items',
            label: 'Состав',
            children: (
              <>
                <ItemsTable order={order} onRemove={onRemoveItem} />
                <Divider />
                <Space wrap>
                  <Button icon={<DownloadOutlined />} onClick={onReExport}>Скачать запрос КП</Button>
                  <Button icon={<ShoppingCartOutlined />} onClick={() => setAddOpen(true)}>Добавить поставщика</Button>
                  {!fromMaterials && (
                    <Button type="primary" icon={<FileExcelOutlined />} onClick={onFreezeExport}>Зафиксировать состав</Button>
                  )}
                  <Dropdown menu={moreMenu as never}><Button icon={<MoreOutlined />}>Ещё</Button></Dropdown>
                </Space>
                <Table rowKey="id" size="small" pagination={false} dataSource={order.offers} columns={offerCols} style={{ marginTop: 8 }}
                  locale={{ emptyText: <Empty description="Добавьте поставщиков, которым отправлен запрос КП" /> }} scroll={{ x: 500 }} />
                <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
                  Приём счетов/КП и выбор победителя — после начала сбора предложений (открыть заказ на вкладке «Заказы»).
                </div>
              </>
            ),
          },
          {
            key: 'schedule',
            label: 'График поставок',
            children: (
              <>
                <Space style={{ marginBottom: 8 }}>
                  <Button icon={<CalendarOutlined />} onClick={() => setSchedEditOpen(true)}>Изменить график</Button>
                </Space>
                <DeliveryGantt materials={ganttMaterials} />
              </>
            ),
          },
        ]}
      />
      <AddSupplierModal
        open={addOpen} onClose={() => setAddOpen(false)}
        onSubmit={(body) => offerMut.mutate({ method: 'post', url: `/supplier-orders/${order.id}/offers`, body }, { onSuccess: () => { setAddOpen(false); refetch(); } })}
      />
      <Modal
        open={schedEditOpen} title="График поставки заказа" width={820} destroyOnClose
        onCancel={() => setSchedEditOpen(false)} onOk={saveSched} okText="Сохранить график" confirmLoading={saveSchedule.isPending}
      >
        <OrderScheduleEditor lines={scheduleLines} initial={initialSchedule} onChange={setSchedDraft} />
      </Modal>
    </>
  );
}

// ---- Таблица состава (позиции заказа) ----
function ItemsTable({ order, onRemove }: { order: SupplierOrderDetail; onRemove?: (itemId: string) => void }) {
  const cols: ColumnsType<SupplierOrderDetail['items'][number]> = [
    { title: 'Материал', dataIndex: 'material_name', key: 'name' },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'qty', width: 100, align: 'right', render: (v) => round4(v) },
    {
      title: 'Дата поставки', dataIndex: 'delivery_date', key: 'dd', width: 120,
      render: (v: string | null) => { if (!v) return '—'; const [y, m, d] = v.split('-'); return `${d}.${m}.${y}`; },
    },
    { title: 'Подрядчик', dataIndex: 'contractor_name', key: 'c', width: 150, render: (v) => v ?? '—' },
    { title: 'Заявка', dataIndex: 'request_no', key: 'r', width: 80, render: (v) => (v ? `№ ${v}` : '—') },
    ...(onRemove ? [{
      title: '', key: 'del', width: 60,
      render: (_: unknown, it: SupplierOrderDetail['items'][number]) => (
        <Popconfirm title="Убрать позицию?" onConfirm={() => onRemove(it.id)}>
          <Button type="link" size="small" danger>Убрать</Button>
        </Popconfirm>
      ),
    } as const] : []),
  ];
  return <Table rowKey="id" size="small" pagination={false} dataSource={order.items} columns={cols} scroll={{ x: 640 }} />;
}

// ---- Этапы «Поставщики» + «Оформление» ----
function SourcingStages({
  order, number, winnerLocal, setWinnerLocal, vatRate, setVatRate, paymentType, setPaymentType,
  prices, setPrices, onReExport, moreMenu, refetch, onClose,
}: {
  order: SupplierOrderDetail; number: string;
  winnerLocal?: string; setWinnerLocal: (v?: string) => void;
  vatRate: ManualVatRate; setVatRate: (v: ManualVatRate) => void;
  paymentType: PaymentType; setPaymentType: (v: PaymentType) => void;
  prices: Map<string, { price: number | null; warranty: number | null }>;
  setPrices: (m: Map<string, { price: number | null; warranty: number | null }>) => void;
  onReExport: () => void; moreMenu: { items: unknown[]; onClick: (e: { key: string }) => void };
  refetch: () => void; onClose: () => void;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const winnerId = winnerLocal;

  const offerMut = useMutation({
    mutationFn: (v: { method: 'post' | 'patch' | 'delete'; url: string; body?: unknown }) =>
      v.method === 'delete' ? api.delete(v.url) : v.method === 'patch' ? api.patch(v.url, v.body) : api.post(v.url, v.body),
    onSuccess: () => refetch(),
    onError: (e: Error) => message.error(e.message),
  });

  const finalize = useMutation({
    mutationFn: (body: unknown) => api.post(`/supplier-orders/${order.id}/finalize`, body),
    onSuccess: () => { message.success('Заказ оформлен'); refetch(); onClose(); },
    onError: (e: Error) => message.error(e.message),
  });

  const rate = Number(MANUAL_VAT_RATE_VALUE[vatRate]);
  const priceOf = (k: string) => prices.get(k) ?? { price: null, warranty: null };
  const setPrice = (k: string, patch: Partial<{ price: number | null; warranty: number | null }>) =>
    setPrices(new Map(prices).set(k, { ...priceOf(k), ...patch }));

  const totals = useMemo(() => {
    let sum = 0;
    for (const a of order.aggItems) {
      const p = priceOf(a.agg_key).price ?? 0;
      const net = roundMoney(Number(a.quantity) * p);
      const vat = roundMoney(net * rate);
      sum += net + vat;
    }
    return roundMoney(sum);
  }, [order.aggItems, prices, rate]);

  const offerCols: ColumnsType<OrderOffer> = [
    {
      title: 'Поставщик', dataIndex: 'supplier_name', key: 'sn',
      render: (v, o) => <Space>{v}{o.supplier_inn ? <span style={{ color: '#8c8c8c' }}>ИНН {o.supplier_inn}</span> : null}</Space>,
    },
    { title: 'Ответ', dataIndex: 'response_status', key: 'rs', width: 170, render: (v) => <Tag color={RESP_COLOR[v]}>{OFFER_RESPONSE_STATUS_LABELS[v as keyof typeof OFFER_RESPONSE_STATUS_LABELS]}</Tag> },
    {
      title: 'Документ', key: 'doc', width: 200,
      render: (_, o) => (
        <Space size={4}>
          {o.has_file ? (
            <a onClick={() => api.downloadGet(`/supplier-orders/${order.id}/offers/${o.id}/file`, o.file_name ?? 'file').catch((e) => message.error((e as Error).message))}>
              <PaperClipOutlined /> {o.document_type ? OFFER_DOC_TYPE_LABELS[o.document_type] : 'Файл'}
            </a>
          ) : <span style={{ color: '#bfbfbf' }}>нет</span>}
          <OfferUpload orderId={order.id} offerId={o.id} onDone={refetch} />
        </Space>
      ),
    },
    {
      title: '', key: 'act', width: 200, align: 'right',
      render: (_, o) => (
        <Space size={4}>
          <Button
            type={winnerId === o.id ? 'primary' : 'default'} size="small" icon={<TrophyOutlined />}
            disabled={o.response_status !== 'received' || !o.has_file}
            onClick={() => setWinnerLocal(winnerId === o.id ? undefined : o.id)}
          >
            {winnerId === o.id ? 'Победитель' : 'Выбрать'}
          </Button>
          <Popconfirm title="Убрать поставщика?" onConfirm={() => offerMut.mutate({ method: 'delete', url: `/supplier-orders/${order.id}/offers/${o.id}` })}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const priceCols: ColumnsType<OrderAggItem> = [
    { title: 'Материал', dataIndex: 'material_name', key: 'm' },
    { title: 'Ед.', dataIndex: 'unit', key: 'u', width: 64 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'q', width: 90, align: 'right', render: (v) => round4(v) },
    {
      title: 'Цена за ед.', key: 'price', width: 120, align: 'right',
      render: (_, a) => <InputNumber min={0} precision={2} value={priceOf(a.agg_key).price ?? undefined} style={{ width: 110 }}
        onChange={(v) => setPrice(a.agg_key, { price: v == null ? null : Number(v) })} />,
    },
    {
      title: 'Гарантия, мес.', key: 'w', width: 120, align: 'right',
      render: (_, a) => <InputNumber min={0} precision={0} value={priceOf(a.agg_key).warranty ?? undefined} style={{ width: 100 }}
        onChange={(v) => setPrice(a.agg_key, { warranty: v == null ? null : Number(v) })} />,
    },
    {
      title: 'Сумма НДС', key: 'vat', width: 120, align: 'right',
      render: (_, a) => { const net = roundMoney(Number(a.quantity) * (priceOf(a.agg_key).price ?? 0)); return money(roundMoney(net * rate)); },
    },
    {
      title: 'Сумма', key: 'sum', width: 130, align: 'right',
      render: (_, a) => { const net = roundMoney(Number(a.quantity) * (priceOf(a.agg_key).price ?? 0)); return <strong>{money(net + roundMoney(net * rate))}</strong>; },
    },
  ];

  function submitFinalize() {
    if (!winnerId) return message.warning('Выберите победителя');
    const lines = order.aggItems.map((a) => ({ aggKey: a.agg_key, unitPrice: priceOf(a.agg_key).price, warrantyMonths: priceOf(a.agg_key).warranty }));
    if (lines.some((l) => l.unitPrice == null)) return message.warning('Укажите цену по всем материалам');
    if (totals <= 0) return message.warning('Итоговая сумма должна быть больше нуля');
    finalize.mutate({
      winnerOfferId: winnerId,
      vatRate, paymentType,
      lines: lines.map((l) => ({ aggKey: l.aggKey, unitPrice: String(l.unitPrice), warrantyMonths: l.warrantyMonths ?? undefined })),
      expectedVersion: order.row_version,
    });
  }

  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Button icon={<DownloadOutlined />} onClick={onReExport}>Скачать запрос КП</Button>
        <Button icon={<ShoppingCartOutlined />} onClick={() => setAddOpen(true)}>Добавить поставщика</Button>
        <Dropdown menu={moreMenu as never}><Button icon={<MoreOutlined />}>Ещё</Button></Dropdown>
      </Space>
      <Table rowKey="id" size="small" pagination={false} dataSource={order.offers} columns={offerCols}
        locale={{ emptyText: <Empty description="Добавьте поставщиков, которым отправлен запрос КП" /> }} scroll={{ x: 700 }} />

      {winnerId && (
        <>
          <Divider orientation="left" plain>Оформление победителя</Divider>
          <Space style={{ marginBottom: 12 }} size="large">
            <span>НДС: <Select value={vatRate} onChange={setVatRate} style={{ width: 130 }}
              options={MANUAL_VAT_RATES.map((r) => ({ value: r, label: MANUAL_VAT_RATE_LABELS[r] }))} /></span>
            <span>Тип поставки: <Select value={paymentType} onChange={setPaymentType} style={{ width: 150 }}
              options={PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] }))} /></span>
          </Space>
          <Table rowKey="agg_key" size="small" pagination={false} dataSource={order.aggItems} columns={priceCols} scroll={{ x: 760 }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={5}><strong>ИТОГО</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right"><strong>{money(totals)}</strong></Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <Button type="primary" loading={finalize.isPending} onClick={submitFinalize}>Оформить заказ</Button>
          </div>
        </>
      )}

      <AddSupplierModal
        open={addOpen} onClose={() => setAddOpen(false)}
        onSubmit={(body) => offerMut.mutate({ method: 'post', url: `/supplier-orders/${order.id}/offers`, body }, { onSuccess: () => { setAddOpen(false); refetch(); } })}
      />
    </>
  );
}

// ---- Загрузка документа поставщика (КП/счёт) ----
function OfferUpload({ orderId, offerId, onDone }: { orderId: string; offerId: string; onDone: () => void }) {
  const { message } = App.useApp();
  const [docType, setDocType] = useState<'quote' | 'invoice'>('quote');
  return (
    <Space size={2}>
      <Select size="small" value={docType} onChange={setDocType} style={{ width: 88 }}
        options={[{ value: 'quote', label: 'КП' }, { value: 'invoice', label: 'Счёт' }]} />
      <Upload
        showUploadList={false} maxCount={1}
        beforeUpload={(file) => {
          const fd = new FormData();
          fd.append('file', file);
          api.upload(`/supplier-orders/${orderId}/offers/${offerId}/file?documentType=${docType}`, fd)
            .then(() => { message.success('Документ приложен'); onDone(); })
            .catch((e) => message.error((e as Error).message));
          return Upload.LIST_IGNORE;
        }}
      >
        <Button size="small" icon={<UploadOutlined />} />
      </Upload>
    </Space>
  );
}

// ---- Выбор поставщика из справочника (поиск по названию/ИНН, ИНН подставляется автоматически) ----
interface SupplierSel { id: string; name: string; inn: string | null }

function SupplierPicker({ value, onChange }: { value?: SupplierSel; onChange: (s?: SupplierSel) => void }) {
  const [search, setSearch] = useState('');
  const suppliersQ = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => api.get<{ data: SupplierSel[] }>(`/suppliers?q=${encodeURIComponent(search)}`),
  });
  const options = useMemo(() => {
    const list = suppliersQ.data?.data ?? [];
    const opts = list.map((s) => ({ value: s.id, label: s.inn ? `${s.name} (ИНН ${s.inn})` : s.name, supplier: s }));
    // Текущий выбор может не попасть в выдачу (лимит) — подмешиваем, чтобы не показывать UUID.
    if (value?.id && !opts.some((o) => o.value === value.id)) {
      opts.unshift({ value: value.id, label: value.inn ? `${value.name} (ИНН ${value.inn})` : value.name, supplier: value });
    }
    return opts;
  }, [suppliersQ.data, value]);
  return (
    <Select
      showSearch filterOption={false} onSearch={setSearch} loading={suppliersQ.isLoading}
      value={value?.id} options={options.map((o) => ({ value: o.value, label: o.label }))}
      placeholder="Поиск по названию или ИНН" style={{ width: '100%' }}
      onChange={(val) => onChange(options.find((o) => o.value === val)?.supplier)}
    />
  );
}

// ---- Модалка добавления поставщика (из справочника) ----
function AddSupplierModal({
  open, onClose, onSubmit,
}: {
  open: boolean; onClose: () => void;
  onSubmit: (b: { supplierId: string; supplierName: string; supplierInn?: string }) => void;
}) {
  const { message } = App.useApp();
  const [sel, setSel] = useState<SupplierSel>();
  return (
    <Modal
      open={open} title="Поставщик" onCancel={onClose} destroyOnClose afterClose={() => setSel(undefined)}
      onOk={() => {
        if (!sel) return message.warning('Выберите поставщика из справочника');
        onSubmit({ supplierId: sel.id, supplierName: sel.name, supplierInn: sel.inn ?? undefined });
        setSel(undefined);
      }}
      okText="Добавить"
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <SupplierPicker value={sel} onChange={setSel} />
        <Input placeholder="ИНН" value={sel?.inn ?? ''} disabled />
      </Space>
    </Modal>
  );
}

// ---- Read-only после оформления ----
function AwardedView({ order, number }: { order: SupplierOrderDetail; number: string }) {
  const rate = order.vat_rate ? Number(MANUAL_VAT_RATE_VALUE[order.vat_rate as ManualVatRate]) : 0;
  const priceByKey = new Map(order.priceLines.map((p) => [p.agg_key, p]));
  const cols: ColumnsType<OrderAggItem> = [
    { title: 'Материал', dataIndex: 'material_name', key: 'm' },
    { title: 'Ед.', dataIndex: 'unit', key: 'u', width: 64 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'q', width: 90, align: 'right', render: (v) => round4(v) },
    { title: 'Цена', key: 'p', width: 110, align: 'right', render: (_, a) => money(priceByKey.get(a.agg_key)?.unit_price ?? 0) },
    { title: 'Гар., мес.', key: 'w', width: 90, align: 'right', render: (_, a) => priceByKey.get(a.agg_key)?.warranty_months ?? '—' },
    { title: 'Сумма НДС', key: 'v', width: 110, align: 'right', render: (_, a) => { const net = roundMoney(Number(a.quantity) * Number(priceByKey.get(a.agg_key)?.unit_price ?? 0)); return money(roundMoney(net * rate)); } },
    { title: 'Сумма', key: 's', width: 120, align: 'right', render: (_, a) => { const net = roundMoney(Number(a.quantity) * Number(priceByKey.get(a.agg_key)?.unit_price ?? 0)); return <strong>{money(net + roundMoney(net * rate))}</strong>; } },
  ];
  return (
    <>
      <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Поставщик">{order.supplier_name ?? '—'}{order.supplier_inn ? `, ИНН ${order.supplier_inn}` : ''}</Descriptions.Item>
        <Descriptions.Item label="Сумма">{money(order.amount)}</Descriptions.Item>
        <Descriptions.Item label="НДС">{order.vat_rate ? MANUAL_VAT_RATE_LABELS[order.vat_rate as ManualVatRate] : '—'}</Descriptions.Item>
        <Descriptions.Item label="Тип поставки">{order.payment_type ? PAYMENT_TYPE_LABELS[order.payment_type as PaymentType] : '—'}</Descriptions.Item>
      </Descriptions>
      <Table rowKey="agg_key" size="small" pagination={false} dataSource={order.aggItems} columns={cols} scroll={{ x: 720 }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={6}><strong>ИТОГО</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={6} align="right"><strong>{money(order.amount)}</strong></Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </>
  );
}

// ---- Компактный вид тендера ----
function TenderView({ order, onRefresh, onAward }: { order: SupplierOrderDetail; onRefresh: () => void; onAward: (pid: string) => void }) {
  const res = order.tender_results;
  const winnerId = res?.winner?.participant_id;
  const finished = order.tender_status === 'finished';
  return (
    <>
      <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Статус">{order.tender_sync_status === 'pending' ? 'В очереди на выгрузку' : order.tender_sync_status === 'failed' ? 'Ошибка выгрузки' : (order.tender_status ?? '—')}</Descriptions.Item>
        <Descriptions.Item label="Портал">{order.tender_url ? <a href={order.tender_url} target="_blank" rel="noopener noreferrer">Открыть</a> : '—'}</Descriptions.Item>
      </Descriptions>
      <ItemsTable order={order} />
      <Space style={{ marginTop: 12 }}>
        <Button onClick={onRefresh}>Обновить результаты</Button>
        {finished && winnerId && res?.outcome !== 'no_award' && (
          <Popconfirm title="Зафиксировать победителя тендера?" onConfirm={() => onAward(winnerId)}>
            <Button type="primary">Зафиксировать победителя</Button>
          </Popconfirm>
        )}
      </Space>
    </>
  );
}
