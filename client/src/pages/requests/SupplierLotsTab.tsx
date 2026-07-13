import { useMemo, useState } from 'react';
import { Table, Select, Segmented, Space, Empty, Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { money } from './requestConstants';
import { SourcingStatusTag, ProcurementMethodTag, TenderStatusTag } from './supplierLotConstants';
import { SupplierLotDetail } from './SupplierLotDetail';
import type { SupplierLotRow } from './types';

interface ProjectOpt { id: string; code: string | null; name: string }
type StatusFilter = 'all' | 'forming' | 'sourcing' | 'awarded' | 'cancelled';

/** Реестр закупочных лотов СУ-10 (снабжение): выгрузка КП/тендер, фиксация поставщика. */
export function SupplierLotsTab({ onGoToMaterials }: { onGoToMaterials?: () => void }) {
  const [projectId, setProjectId] = useState<string | undefined>();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ data: ProjectOpt[] }>('/projects'),
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (projectId) p.set('projectId', projectId);
    if (status !== 'all') p.set('status', status);
    p.set('limit', String(pageSize));
    p.set('offset', String((page - 1) * pageSize));
    return p.toString();
  }, [projectId, status, page, pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-lots', 'list', projectId ?? '', status, page, pageSize],
    queryFn: () => api.get<{ data: SupplierLotRow[]; meta: { total: number } }>(`/supplier-orders?${qs}`),
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const columns: ColumnsType<SupplierLotRow> = [
    { title: '№', dataIndex: 'order_no', key: 'no', width: 80, render: (v: number | null) => <strong>Л-{String(v ?? 0).padStart(3, '0')}</strong> },
    { title: 'Объект', dataIndex: 'project_name', key: 'project', render: (v) => v ?? '—' },
    { title: 'Название', dataIndex: 'title', key: 'title', render: (v) => v ?? '—' },
    { title: 'Стадия', dataIndex: 'sourcing_status', key: 'stage', width: 150, render: (v: string) => <SourcingStatusTag status={v} /> },
    { title: 'Канал', dataIndex: 'procurement_method', key: 'method', width: 160, render: (v: string | null) => <ProcurementMethodTag method={v} /> },
    { title: 'Тендер', dataIndex: 'tender_status', key: 'tender', width: 160, render: (v: string | null) => <TenderStatusTag status={v} /> },
    { title: 'Поставщик', dataIndex: 'supplier_name', key: 'supplier', render: (v) => v ?? '—' },
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', width: 130, align: 'right', render: (v) => money(v) },
    { title: 'Позиций', dataIndex: 'items_count', key: 'items', width: 90, align: 'right' },
    { title: 'Заявок', dataIndex: 'requests_count', key: 'reqs', width: 90, align: 'right' },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          showSearch
          placeholder="Все объекты"
          style={{ width: 300 }}
          value={projectId}
          onChange={(v) => { setProjectId(v); setPage(1); }}
          loading={projectsQ.isLoading}
          optionFilterProp="label"
          options={(projectsQ.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.code ? `${p.code} · ` : ''}${p.name}` }))}
        />
        <Segmented
          value={status}
          onChange={(v) => { setStatus(v as StatusFilter); setPage(1); }}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'forming', label: 'Формируются' },
            { value: 'sourcing', label: 'В закупке' },
            { value: 'awarded', label: 'Присуждены' },
            { value: 'cancelled', label: 'Отменены' },
          ]}
        />
      </Space>
      <Table<SupplierLotRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        expandable={{ expandedRowRender: (r) => <SupplierLotDetail lotId={r.id} />, rowExpandable: () => true }}
        pagination={{
          ...DEFAULT_PAGINATION,
          current: page,
          pageSize,
          total,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        scroll={{ x: 1200 }}
        locale={{ emptyText: (
          <Empty description="Закупочных лотов пока нет. Лот формируется из материалов заявок СУ-10 на вкладке «Материалы».">
            {onGoToMaterials && (
              <Button type="primary" onClick={onGoToMaterials}>Перейти к формированию лота</Button>
            )}
          </Empty>
        ) }}
      />
    </>
  );
}
