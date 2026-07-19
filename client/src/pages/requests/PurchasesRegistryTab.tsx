import { useMemo, useState } from 'react';
import { Table, Select, Space, Empty, Tag, Alert, App } from 'antd';
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
import { type ColumnFilters } from '../../lib/columnFilters';
import { useGroupedTable, computeNeedFull } from '../../lib/useGroupedTable';
import { isGroupRow, type GroupLevel, type GroupNode, type GroupRow } from '../../lib/tableGrouping';
import { ColumnSettingsButton } from '../../components/table/ColumnSettingsButton';
import { purchasesRegistryColumnsStore } from './columns/purchasesRegistryColumns';
import { ConfirmIconButton } from '../../components/shared/ConfirmIconButton';
import { money } from './requestConstants';
import { SupplierOrderModal } from './SupplierOrderModal';
import { RequestDetailModal } from './RequestDetailModal';
import type { RegistryRow } from './types';

interface ProjectOpt { id: string; code: string | null; name: string }
type Row = GroupRow<RegistryRow>;

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
  const [colFilters, setColFilters] = useState<ColumnFilters>({});
  const [peek, setPeek] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | undefined>();
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ data: ProjectOpt[] }>('/projects') });

  const order = purchasesRegistryColumnsStore.useStore((s) => s.order);
  const hidden = purchasesRegistryColumnsStore.useStore((s) => s.hidden);
  const groupBy = purchasesRegistryColumnsStore.useStore((s) => s.groupBy);
  const prefs = purchasesRegistryColumnsStore.resolve(order, hidden);
  const needFull = computeNeedFull(prefs, groupBy, colFilters, peek);

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
    if (needFull) p.set('all', '1');
    else { p.set('limit', String(pageSize)); p.set('offset', String((page - 1) * pageSize)); }
    return p.toString();
  }, [projectId, types, page, pageSize, needFull]);

  const { data, isLoading } = useQuery({
    queryKey: ['purchases-registry', projectId ?? '', types.join(','), needFull ? 'all' : page, needFull ? 0 : pageSize],
    queryFn: () => api.get<{ data: RegistryRow[]; meta: { total: number; truncated?: boolean } }>(`/supplier-orders/registry?${qs}`),
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const truncated = (data?.meta?.truncated ?? false) && needFull;

  function openRow(r: RegistryRow) {
    if (r.link_kind === 'order') setOpenOrderId(r.id);
    else setOpenRequestId(r.id);
  }

  const levelMap = useMemo<Record<string, GroupLevel<RegistryRow> | undefined>>(() => ({
    kind: { key: 'kind', idOf: (r) => r.kind_tag, labelOf: (r) => PURCHASE_KIND_LABELS[r.kind_tag] ?? r.kind_tag },
    project: { key: 'project', idOf: (r) => r.project_name ?? 'none', labelOf: (r) => r.project_name || '— Без объекта' },
    supplier: { key: 'supplier', idOf: (r) => r.supplier_name ?? 'none', labelOf: (r) => r.supplier_name || '— Без поставщика' },
    status: { key: 'status', idOf: (r) => `${r.link_kind}:${r.status}`, labelOf: (r) => statusLabel(r) },
  }), []);

  const filterSpecs = useMemo(() => ({
    kind: { kind: 'multi' as const, getText: (r: RegistryRow) => r.kind_tag, labelOf: (v: string) => PURCHASE_KIND_LABELS[v as PurchaseKind] ?? v },
    no: { kind: 'text' as const, getText: (r: RegistryRow) => r.number },
    project: { kind: 'multi' as const, getText: (r: RegistryRow) => r.project_name },
    supplier: { kind: 'multi' as const, getText: (r: RegistryRow) => r.supplier_name },
    amount: { kind: 'numRange' as const, getNum: (r: RegistryRow) => r.amount },
    status: { kind: 'multi' as const, getText: (r: RegistryRow) => statusLabel(r) },
  }), []);

  const gt = useGroupedTable<RegistryRow>({
    store: purchasesRegistryColumnsStore,
    rows, filterSpecs, levelMap,
    aggregate: (items) => ({ amount: items.reduce((s, x) => s + Number(x.amount ?? 0), 0) }),
    colFilters, setColFilters, onPeek: () => setPeek(true), onChange: () => setPage(1),
  });

  const leaf = (r: Row) => r as RegistryRow;
  const leafColumns: ColumnsType<Row> = [
    { title: 'Вид', key: 'kind', width: 170, ...gt.hf('kind', filterSpecs.kind), render: (_v, r) => { const v = leaf(r).kind_tag; return <Tag color={KIND_COLOR[v]}>{PURCHASE_KIND_LABELS[v]}</Tag>; } },
    { title: '№', key: 'no', width: 110, ...gt.hf('no', filterSpecs.no), render: (_v, r) => <a onClick={(e) => { e.stopPropagation(); openRow(leaf(r)); }}>{leaf(r).number}</a> },
    { title: 'Объект', key: 'project', ...gt.hf('project', filterSpecs.project), render: (_v, r) => leaf(r).project_name ?? '—' },
    { title: 'Поставщик', key: 'supplier', ...gt.hf('supplier', filterSpecs.supplier), render: (_v, r) => leaf(r).supplier_name ?? '—' },
    { title: 'Сумма', key: 'amount', width: 130, align: 'right', ...gt.hf('amount', filterSpecs.amount), render: (_v, r) => money(leaf(r).amount) },
    { title: 'Статус', key: 'status', width: 160, ...gt.hf('status', filterSpecs.status), render: (_v, r) => <Tag>{statusLabel(leaf(r))}</Tag> },
    {
      title: 'Действие', key: 'act', width: 120, align: 'right',
      onCell: () => ({ onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() }),
      render: (_v, r) => {
        const row = leaf(r);
        const isManualOrder = row.link_kind === 'order' && row.kind_tag === 'supplier_order';
        const canDelete = isManualOrder && row.status === 'forming' && (isAdmin || row.created_by === user?.id);
        const canCancel = isManualOrder && row.status === 'sourcing';
        return (
          <Space size={4}>
            {row.tender_url && <a href={row.tender_url} target="_blank" rel="noopener noreferrer"><LinkOutlined /></a>}
            {canCancel && (
              <ConfirmIconButton tooltip="Отменить закупку" title="Отменить закупку?" description="Остаток материалов вернётся в свод."
                okText="Отменить" onConfirm={() => cancelMut.mutate(row.id)} icon={<StopOutlined />} type="text" />
            )}
            {canDelete && (
              <ConfirmIconButton tooltip="Удалить заказ" title="Удалить заказ?" description="Позиции вернутся в свод материалов."
                onConfirm={() => delMut.mutate(row.id)} icon={<DeleteOutlined />} type="text" danger />
            )}
          </Space>
        );
      },
    },
  ];

  const renderGroup = (node: GroupNode<RegistryRow>) => (
    <strong>{node.label} <span style={{ color: '#8c8c8c', fontWeight: 400 }}>· {node.count} · {money(node.agg.amount ?? 0)}</span></strong>
  );

  const tableData = gt.data;
  const columns = gt.view(leafColumns, renderGroup);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Space style={{ marginBottom: 12, flexShrink: 0, paddingTop: 4, width: '100%' }} wrap>
        <Select allowClear showSearch placeholder="Все объекты" style={{ width: 300 }}
          value={projectId} onChange={(v) => { setProjectId(v); setPage(1); }} loading={projectsQ.isLoading}
          optionFilterProp="label"
          options={(projectsQ.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.code ? `${p.code} · ` : ''}${p.name}` }))} />
        <Select allowClear mode="multiple" placeholder="Все виды" style={{ minWidth: 260 }}
          value={types} onChange={(v) => { setTypes(v); setPage(1); }}
          options={PURCHASE_KINDS.map((k) => ({ value: k, label: PURCHASE_KIND_LABELS[k] }))} />
        <div style={{ marginLeft: 'auto' }}>
          <ColumnSettingsButton store={purchasesRegistryColumnsStore} />
        </div>
      </Space>
      {truncated && (
        <Alert type="warning" showIcon style={{ marginBottom: 8, flexShrink: 0 }}
          message={`Показаны первые ${rows.length} из ${total}. Отборы и дерево строятся по показанным — сузьте фильтры сверху.`} />
      )}
      <div className="table-page-wrapper">
        <Table<Row>
          rowKey={(r) => (isGroupRow(r) ? r.key : `${leaf(r).link_kind}:${leaf(r).id}`)}
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={tableData}
          expandable={gt.expandable}
          onRow={(r) => (isGroupRow(r) ? {} : { onClick: () => openRow(leaf(r)), style: { cursor: 'pointer' } })}
          locale={{ emptyText: <Empty description="Закупок пока нет. Заказ формируется из материалов заявок СУ-10 на вкладке «Материалы»." /> }}
          pagination={needFull
            ? { ...DEFAULT_PAGINATION }
            : { ...DEFAULT_PAGINATION, current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
          scroll={{ x: 900, y: 'flex' }}
        />
      </div>
      {openOrderId && <SupplierOrderModal orderId={openOrderId} onClose={() => setOpenOrderId(undefined)} />}
      <RequestDetailModal id={openRequestId} onClose={() => setOpenRequestId(null)} />
    </div>
  );
}
