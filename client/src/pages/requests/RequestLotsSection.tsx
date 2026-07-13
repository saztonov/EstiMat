import { useState } from 'react';
import { Table, Space, Typography, Empty, Button } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { money, round4 } from './requestConstants';
import { SourcingStatusTag, ProcurementMethodTag, TenderStatusTag } from './supplierLotConstants';
import { SupplierLotDetail } from './SupplierLotDetail';
import { SupplierLotFormModal } from './SupplierLotFormModal';
import type { Su10MaterialRow } from './types';

const { Text } = Typography;

interface LotBrief {
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
interface ByRequest { lots: LotBrief[]; coverage: Coverage; projectId: string | null; materials: Su10MaterialRow[] }

/**
 * Секция карточки su10-заявки: в какие закупочные лоты вошли её материалы + сводка покрытия.
 * Снабжению — формирование лота прямо из материалов заявки и полное управление лотом
 * (раскрытие строки: старт закупки, «Создать тендер», фиксация поставщика).
 */
export function RequestLotsSection({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isSupply = role === 'engineer' || role === 'admin' || role === 'manager';
  const [formOpen, setFormOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['request-lots', requestId],
    queryFn: () => api.get<{ data: ByRequest }>(`/supplier-orders/by-request/${requestId}`),
  });
  const lots = data?.data?.lots ?? [];
  const cov = data?.data?.coverage;
  const projectId = data?.data?.projectId ?? null;
  const formableRows = (data?.data?.materials ?? []).filter((m) => m.remaining > 1e-6);

  const columns: ColumnsType<LotBrief> = [
    { title: '№', dataIndex: 'order_no', key: 'no', width: 80, render: (v) => `Л-${String(v ?? 0).padStart(3, '0')}` },
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
        <Text type="secondary">
          Запрошено: {round4(cov.requested)} · В лотах: {round4(cov.placed)} · Присуждено: {round4(cov.awarded)}
        </Text>
      )}
      {isSupply && projectId && formableRows.length > 0 && (
        <Button type="primary" icon={<ShoppingCartOutlined />} onClick={() => setFormOpen(true)}>
          Сформировать закупочный лот
        </Button>
      )}
      {lots.length === 0 ? (
        <Empty description="Материалы заявки ещё не включены в закупочные лоты" />
      ) : (
        <Table<LotBrief>
          rowKey="id"
          size="small"
          loading={isLoading}
          pagination={false}
          dataSource={lots}
          columns={columns}
          scroll={{ x: 900 }}
          expandable={isSupply ? { expandedRowRender: (r) => <SupplierLotDetail lotId={r.id} />, rowExpandable: () => true } : undefined}
        />
      )}

      {formOpen && projectId && (
        <SupplierLotFormModal
          open
          projectId={projectId}
          rows={formableRows}
          onClose={() => setFormOpen(false)}
          onDone={() => {
            setFormOpen(false);
            qc.invalidateQueries({ queryKey: ['request-lots', requestId] });
            qc.invalidateQueries({ queryKey: ['supplier-lots'] });
          }}
        />
      )}
    </Space>
  );
}
