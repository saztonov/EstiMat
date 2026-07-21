import { useMemo, useState } from 'react';
import { Button, Space, Tabs, Alert, App } from 'antd';
import { CalendarOutlined, DownloadOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { DeliveryGantt, type GanttMaterial } from '../../contractors/DeliveryGantt';
import { OrderScheduleEditor } from '../OrderScheduleEditor';
import { validateOrderSchedule, type OrderScheduleLine, type OrderScheduleValue } from '../orderSchedule';
import { ItemsTable } from './ItemsTable';
import type { SupplierOrderDetail } from '../types';

/**
 * Блок «Материалы и график»: что заказываем и к каким датам.
 *
 * График правится ЗДЕСЬ ЖЕ, переключением вида, а не в отдельной модалке поверх окна: окно
 * задумано единым, и всплывающее окно поверх него возвращало бы ту самую многооконность.
 */
export function CompositionBlock({ order, editable, onRemoveItem, onReExport, refetch }: {
  order: SupplierOrderDetail;
  /** Состав и график заморожены после фиксации — тогда блок только показывает. */
  editable: boolean;
  onRemoveItem: (itemId: string) => void;
  onReExport: () => void;
  refetch: () => void;
}) {
  const { message } = App.useApp();
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [schedDraft, setSchedDraft] = useState<OrderScheduleValue[]>([]);

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
    mutationFn: () => api.put(`/supplier-orders/${order.id}/delivery-schedule`, {
      schedule: schedDraft, expectedVersion: order.row_version,
    }),
    onSuccess: () => { message.success('График сохранён'); setEditingSchedule(false); refetch(); },
    onError: (e: Error) => message.error(e.message),
  });

  function saveSched() {
    const err = validateOrderSchedule(scheduleLines, schedDraft);
    if (err) return message.warning(err);
    saveSchedule.mutate();
  }

  return (
    <Tabs
      size="small"
      items={[
        {
          key: 'items',
          label: `Состав (${order.items.length})`,
          children: (
            <>
              <ItemsTable order={order} onRemove={editable ? onRemoveItem : undefined} />
              <Space style={{ marginTop: 12 }}>
                <Button icon={<DownloadOutlined />} onClick={onReExport}>Скачать запрос КП</Button>
              </Space>
            </>
          ),
        },
        {
          key: 'schedule',
          label: 'График поставок',
          children: editingSchedule ? (
            <>
              <OrderScheduleEditor lines={scheduleLines} initial={initialSchedule} onChange={setSchedDraft} />
              <Space style={{ marginTop: 12 }}>
                <Button type="primary" loading={saveSchedule.isPending} onClick={saveSched}>Сохранить график</Button>
                <Button onClick={() => setEditingSchedule(false)}>Отмена</Button>
              </Space>
            </>
          ) : (
            <>
              {editable && (
                <Space style={{ marginBottom: 8 }}>
                  <Button icon={<CalendarOutlined />} onClick={() => setEditingSchedule(true)}>Изменить график</Button>
                </Space>
              )}
              {ganttMaterials.length === 0
                ? <Alert type="info" showIcon message="График поставок не задан" />
                : <DeliveryGantt materials={ganttMaterials} />}
            </>
          ),
        },
      ]}
    />
  );
}
