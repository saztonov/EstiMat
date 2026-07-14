import { useMemo, useState } from 'react';
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
import type { Su10MaterialRow, CategoryResponsibles } from './types';

const { Text } = Typography;
const EPS = 1e-6;

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
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const isSupply = role === 'engineer' || role === 'admin' || role === 'manager';
  const isAdmin = role === 'admin';
  const [formOpen, setFormOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['request-lots', requestId],
    queryFn: () => api.get<{ data: ByRequest }>(`/supplier-orders/by-request/${requestId}`),
  });

  // Зоны ответственности (справочник «Закупки») — какие категории может распределять пользователь.
  const responsiblesQ = useQuery({
    queryKey: ['procurement-responsibles'],
    queryFn: () => api.get<{ data: CategoryResponsibles[] }>('/procurement/responsibles'),
    enabled: isSupply,
  });
  const responsiblesReady = responsiblesQ.isSuccess;
  const { myCategoryIds, categoriesWithResp } = useMemo(() => {
    const mine = new Set<string>();
    const withResp = new Set<string>();
    for (const c of responsiblesQ.data?.data ?? []) {
      if (c.responsibles.length > 0) withResp.add(c.id);
      if (user && c.responsibles.some((r) => r.id === user.id)) mine.add(c.id);
    }
    return { myCategoryIds: mine, categoriesWithResp: withResp };
  }, [responsiblesQ.data, user]);

  const lots = data?.data?.lots ?? [];
  const cov = data?.data?.coverage;
  const projectId = data?.data?.projectId ?? null;
  const allFormable = (data?.data?.materials ?? []).filter((m) => (m.remaining ?? 0) > EPS);
  // Доступны для распределения только категории пользователя (или fallback без ответственных); admin — все.
  function canDistribute(m: Su10MaterialRow): boolean {
    if (!responsiblesReady) return false;
    if (isAdmin) return true;
    if (!m.category_id) return false;
    return myCategoryIds.has(m.category_id) || !categoriesWithResp.has(m.category_id);
  }
  const formableRows = allFormable.filter(canDistribute);
  const excludedCount = allFormable.length - formableRows.length;

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
        <Space>
          <Button type="primary" icon={<ShoppingCartOutlined />} onClick={() => setFormOpen(true)}>
            Сформировать закупочный лот
          </Button>
          {excludedCount > 0 && (
            <Text type="secondary">{excludedCount} поз. вне вашей зоны ответственности — недоступны</Text>
          )}
        </Space>
      )}
      {isSupply && projectId && formableRows.length === 0 && excludedCount > 0 && (
        <Text type="secondary">Материалы заявки вне вашей зоны ответственности — распределение недоступно</Text>
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
