import { useState } from 'react';
import { Table, Space, Typography, Empty, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { money, round4 } from './requestConstants';
import { SourcingStatusTag, ProcurementMethodTag, TenderStatusTag } from './supplierLotConstants';
import { SupplierOrderModal } from './SupplierOrderModal';

const { Text } = Typography;

interface OrderBrief {
  id: string;
  order_no: number | null;
  title: string | null;
  sourcing_status: string;
  procurement_method: string | null;
  tender_status: string | null;
  supplier_name: string | null;
  amount: string | number | null;
  qty: string | number;
}
interface Coverage { requested: string | number; placed: string | number; awarded: string | number }
interface ByRequest { lots: OrderBrief[]; coverage: Coverage; projectId: string | null }

/**
 * Секция карточки su10-заявки «Заказы» (обзор): в какие заказы вошли материалы + сводка покрытия.
 * Формирование заказа — только со вкладки «Материалы»; отсюда заказ можно открыть и вести.
 */
export function RequestLotsSection({ requestId }: { requestId: string }) {
  const [openOrderId, setOpenOrderId] = useState<string | undefined>();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['request-lots', requestId],
    queryFn: () => api.get<{ data: ByRequest }>(`/supplier-orders/by-request/${requestId}`),
  });

  const orders = data?.data?.lots ?? [];
  const cov = data?.data?.coverage;

  const columns: ColumnsType<OrderBrief> = [
    { title: '№', dataIndex: 'order_no', key: 'no', width: 80, render: (v, r) => <a onClick={() => setOpenOrderId(r.id)}>{`З-${String(v ?? 0).padStart(3, '0')}`}</a> },
    { title: 'Название', dataIndex: 'title', key: 'title', render: (v) => v ?? '—' },
    { title: 'Стадия', dataIndex: 'sourcing_status', key: 'stage', width: 140, render: (v) => <SourcingStatusTag status={v} /> },
    { title: 'Канал', dataIndex: 'procurement_method', key: 'method', width: 150, render: (v) => <ProcurementMethodTag method={v} /> },
    { title: 'Тендер', dataIndex: 'tender_status', key: 'tender', width: 150, render: (v) => <TenderStatusTag status={v} /> },
    { title: 'Кол-во из заявки', dataIndex: 'qty', key: 'qty', width: 130, align: 'right', render: (v) => round4(v) },
    { title: 'Поставщик', dataIndex: 'supplier_name', key: 'supplier', render: (v) => v ?? '—' },
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', width: 120, align: 'right', render: (v) => money(v) },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      {cov && (
        <Space size={6} wrap>
          <Text type="secondary">
            Запрошено: {round4(cov.requested)} · В заказах: {round4(cov.placed)} · Оформлено: {round4(cov.awarded)}
          </Text>
          {/* Объём заявки можно уменьшить ниже уже размещённого — тогда покрытие превышает
              запрошенное, и это должно быть видно, а не спрятано в арифметике. */}
          {Number(cov.placed) > Number(cov.requested) && <Tag color="red">перезаказ</Tag>}
        </Space>
      )}
      {orders.length === 0 ? (
        <Empty description="Материалы заявки ещё не включены в заказы. Заказ формируется на вкладке «Материалы»." />
      ) : (
        <Table<OrderBrief>
          rowKey="id" size="small" loading={isLoading} pagination={false}
          dataSource={orders} columns={columns} scroll={{ x: 900 }}
        />
      )}
      {openOrderId && (
        <SupplierOrderModal orderId={openOrderId} onClose={() => { setOpenOrderId(undefined); refetch(); }} onChanged={() => refetch()} />
      )}
    </Space>
  );
}
