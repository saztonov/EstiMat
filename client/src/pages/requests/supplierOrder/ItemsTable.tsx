import { Table, Button, Popconfirm } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { round4 } from '../requestConstants';
import type { SupplierOrderDetail } from '../types';

/** Состав заказа: позиции заявок (по одной на дату поставки). Кнопка «Убрать» — только пока состав правится. */
export function ItemsTable({ order, onRemove }: { order: SupplierOrderDetail; onRemove?: (itemId: string) => void }) {
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
