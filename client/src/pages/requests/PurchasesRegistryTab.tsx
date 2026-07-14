import { useMemo, useState } from 'react';
import { Table, Select, Space, Empty, Tag, Button, Popconfirm, Tooltip, App } from 'antd';
import { LinkOutlined, DeleteOutlined, StopOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PURCHASE_KINDS, PURCHASE_KIND_LABELS,
  SOURCING_STATUS_LABELS, REQUEST_STATUS_LABELS,
  type PurchaseKind, type SourcingStatus, type RequestStatus,
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { money } from './requestConstants';
import { SupplierOrderModal } from './SupplierOrderModal';
import { RequestDetailModal } from './RequestDetailModal';
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
  const { message } = App.useApp();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [projectId, setProjectId] = useState<string | undefined>();
  const [types, setTypes] = useState<PurchaseKind[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [openOrderId, setOpenOrderId] = useState<string | undefined>();
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ data: ProjectOpt[] }>('/projects') });

  const invalidateRegistry = () => {
    qc.invalidateQueries({ queryKey: ['purchases-registry'] });
    qc.invalidateQueries({ queryKey: ['su10-materials'] });
    qc.invalidateQueries({ queryKey: ['supplier-lots'] });
    qc.invalidateQueries({ queryKey: ['requests'] });
  };
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/supplier-orders/${id}`),
    onSuccess: () => { message.success('Заказ удалён'); invalidateRegistry(); },
    onError: (e: Error) => message.error(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => api.post(`/supplier-orders/${id}/cancel`, {}),
    onSuccess: () => { message.success('Закупка отменена, остаток возвращён в свод'); invalidateRegistry(); },
    onError: (e: Error) => message.error(e.message),
  });

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
    else setOpenRequestId(r.id);
  }

  const columns: ColumnsType<RegistryRow> = [
    { title: 'Вид', dataIndex: 'kind_tag', key: 'kind', width: 170, render: (v: PurchaseKind) => <Tag color={KIND_COLOR[v]}>{PURCHASE_KIND_LABELS[v]}</Tag> },
    { title: '№', dataIndex: 'number', key: 'no', width: 110, render: (v, r) => <a onClick={() => openRow(r)}>{v}</a> },
    { title: 'Объект', dataIndex: 'project_name', key: 'project', render: (v) => v ?? '—' },
    { title: 'Поставщик', dataIndex: 'supplier_name', key: 'supplier', render: (v) => v ?? '—' },
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', width: 130, align: 'right', render: (v) => money(v) },
    { title: 'Статус', key: 'status', width: 160, render: (_, r) => <Tag>{statusLabel(r)}</Tag> },
    {
      title: 'Действие', key: 'act', width: 120, align: 'right',
      render: (_, r) => {
        const isManualOrder = r.link_kind === 'order' && r.kind_tag === 'supplier_order';
        const canDelete = isManualOrder && r.status === 'forming' && (isAdmin || r.created_by === user?.id);
        const canCancel = isManualOrder && r.status === 'sourcing';
        return (
          <Space size={4} onClick={(e) => e.stopPropagation()}>
            {r.tender_url && (
              <a href={r.tender_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><LinkOutlined /></a>
            )}
            {canCancel && (
              <Popconfirm
                title="Отменить закупку?" description="Остаток материалов вернётся в свод."
                okText="Отменить" okButtonProps={{ danger: true }} cancelText="Отмена"
                onConfirm={() => cancelMut.mutate(r.id)}
              >
                <Tooltip title="Отменить закупку"><Button type="text" size="small" icon={<StopOutlined />} /></Tooltip>
              </Popconfirm>
            )}
            {canDelete && (
              <Popconfirm
                title="Удалить заказ?" description="Позиции вернутся в свод материалов."
                okText="Удалить" okButtonProps={{ danger: true }} cancelText="Отмена"
                onConfirm={() => delMut.mutate(r.id)}
              >
                <Tooltip title="Удалить заказ"><Button danger type="text" size="small" icon={<DeleteOutlined />} /></Tooltip>
              </Popconfirm>
            )}
          </Space>
        );
      },
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
      <RequestDetailModal id={openRequestId} onClose={() => setOpenRequestId(null)} />
    </>
  );
}
