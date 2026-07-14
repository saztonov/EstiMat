import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Table, Select, Space, Empty, Tag, Button } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import {
  PURCHASE_KINDS, PURCHASE_KIND_LABELS,
  SOURCING_STATUS_LABELS, REQUEST_STATUS_LABELS,
  type PurchaseKind, type SourcingStatus, type RequestStatus,
} from '@estimat/shared';
import { api } from '../../services/api';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { money } from './requestConstants';
import { SupplierOrderModal } from './SupplierOrderModal';
import type { RegistryRow } from './types';

interface ProjectOpt { id: string; code: string | null; name: string }

const KIND_COLOR: Record<PurchaseKind, string> = {
  supplier_order: 'cyan', tender: 'blue', rp_order: 'geekblue', direct_order: 'purple',
};

function statusLabel(r: RegistryRow): string {
  if (r.link_kind === 'order') return SOURCING_STATUS_LABELS[r.status as SourcingStatus] ?? r.status;
  return REQUEST_STATUS_LABELS[r.status as RequestStatus] ?? r.status;
}

/** Единый реестр закупок: заказ поставщику / тендер / заказ по РП / заказ поставщиком. */
export function PurchasesRegistryTab() {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string | undefined>();
  const [types, setTypes] = useState<PurchaseKind[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [openOrderId, setOpenOrderId] = useState<string | undefined>();

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ data: ProjectOpt[] }>('/projects') });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (projectId) p.set('projectId', projectId);
    if (types.length) p.set('type', types.join(','));
    p.set('limit', String(pageSize));
    p.set('offset', String((page - 1) * pageSize));
    return p.toString();
  }, [projectId, types, page, pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: ['purchases-registry', projectId ?? '', types.join(','), page, pageSize],
    queryFn: () => api.get<{ data: RegistryRow[]; meta: { total: number } }>(`/supplier-orders/registry?${qs}`),
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  function openRow(r: RegistryRow) {
    if (r.link_kind === 'order') setOpenOrderId(r.id);
    else navigate(`/requests/${r.id}`);
  }

  const columns: ColumnsType<RegistryRow> = [
    { title: 'Вид', dataIndex: 'kind_tag', key: 'kind', width: 170, render: (v: PurchaseKind) => <Tag color={KIND_COLOR[v]}>{PURCHASE_KIND_LABELS[v]}</Tag> },
    { title: '№', dataIndex: 'number', key: 'no', width: 110, render: (v, r) => <a onClick={() => openRow(r)}>{v}</a> },
    { title: 'Объект', dataIndex: 'project_name', key: 'project', render: (v) => v ?? '—' },
    { title: 'Поставщик', dataIndex: 'supplier_name', key: 'supplier', render: (v) => v ?? '—' },
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', width: 130, align: 'right', render: (v) => money(v) },
    { title: 'Статус', key: 'status', width: 160, render: (_, r) => <Tag>{statusLabel(r)}</Tag> },
    {
      title: '', key: 'act', width: 60, align: 'right',
      render: (_, r) => (r.tender_url ? <a href={r.tender_url} target="_blank" rel="noopener noreferrer"><LinkOutlined /></a> : null),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear showSearch placeholder="Все объекты" style={{ width: 300 }}
          value={projectId} onChange={(v) => { setProjectId(v); setPage(1); }} loading={projectsQ.isLoading}
          optionFilterProp="label"
          options={(projectsQ.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.code ? `${p.code} · ` : ''}${p.name}` }))}
        />
        <Select
          allowClear mode="multiple" placeholder="Все виды" style={{ minWidth: 260 }}
          value={types} onChange={(v) => { setTypes(v); setPage(1); }}
          options={PURCHASE_KINDS.map((k) => ({ value: k, label: PURCHASE_KIND_LABELS[k] }))}
        />
      </Space>
      <Table<RegistryRow>
        rowKey={(r) => `${r.link_kind}:${r.id}`}
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        onRow={(r) => ({ onClick: () => openRow(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty description="Закупок пока нет. Заказ формируется из материалов заявок СУ-10 на вкладке «Материалы»." /> }}
        pagination={{ ...DEFAULT_PAGINATION, current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        scroll={{ x: 900 }}
      />
      {openOrderId && (
        <SupplierOrderModal orderId={openOrderId} onClose={() => setOpenOrderId(undefined)} />
      )}
    </>
  );
}
