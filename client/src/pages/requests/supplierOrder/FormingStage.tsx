import { useMemo, useState } from 'react';
import {
  Modal, Tabs, Table, Button, Space, Tag, Empty, Divider, Popconfirm, Dropdown, App,
} from 'antd';
import {
  ShoppingCartOutlined, DownloadOutlined, DeleteOutlined, FileExcelOutlined, MoreOutlined, CalendarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMutation } from '@tanstack/react-query';
import { OFFER_RESPONSE_STATUS_LABELS } from '@estimat/shared';
import { api } from '../../../services/api';
import { DeliveryGantt, type GanttMaterial } from '../../contractors/DeliveryGantt';
import { OrderScheduleEditor } from '../OrderScheduleEditor';
import { validateOrderSchedule, type OrderScheduleLine, type OrderScheduleValue } from '../orderSchedule';
import { ItemsTable } from './ItemsTable';
import { AddSupplierModal } from './SupplierPicker';
import type { SupplierOrderDetail, OrderOffer } from '../types';

const RESP_COLOR: Record<string, string> = { pending: 'default', received: 'green', no_response: 'warning' };

/**
 * Этап «Состав» (forming): состав + запрос КП + добавление поставщиков.
 * Приём счетов/КП и выбор победителя здесь недоступны — только после начала сбора предложений
 * (sourcing), т.е. при открытии заказа из вкладки «Заказы».
 */
export function FormingStage({
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
