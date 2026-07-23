import { useMemo, useState } from 'react';
import { Table, Space, Select, Input, DatePicker, Empty, Button, Tooltip, Badge, Alert, App } from 'antd';
import { SearchOutlined, PaperClipOutlined, MessageOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUnreadCounts } from './useUnreadCounts';
import {
  MATERIAL_REQUEST_TYPES,
  MATERIAL_REQUEST_TYPE_LABELS,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  SOURCING_STATUS_LABELS,
  type SourcingStatus,
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { type ColumnFilters } from '../../lib/columnFilters';
import { useGroupedTable, computeNeedFull } from '../../lib/useGroupedTable';
import { isGroupRow, type GroupLevel, type GroupNode, type GroupRow } from '../../lib/tableGrouping';
import { ColumnSettingsButton } from '../../components/table/ColumnSettingsButton';
import { requestsListColumnsStore } from './columns/requestsListColumns';
import { ConfirmIconButton } from '../../components/shared/ConfirmIconButton';
import { RequestStatusTag, RequestTypeTag, money } from './requestConstants';
import { RequestDetailModal } from './RequestDetailModal';
import { parseRequestInPurchase } from './requestInPurchase';
import type { RequestRow } from './types';

interface Filters {
  type?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

type Row = GroupRow<RequestRow>;

const DELETE_BASE_TEXT = 'Заявка, документы и позиции заказов будут удалены без возможности восстановления.';

function deleteDescription(r: RequestRow) {
  if (!r.in_active_purchase) return DELETE_BASE_TEXT;
  // Кнопку не прячем: флаг в списке может устареть в обе стороны, авторитетен сервер (409).
  return (
    <>
      <strong>Материалы заявки находятся в активной закупке — удаление будет заблокировано.</strong>{' '}
      Сначала отмените или удалите заказ поставщику в реестре «Заказы».
    </>
  );
}

function deleteResultText(res?: { lotsDeleted: number; lotsKept: number }): string {
  const parts = ['Заявка удалена'];
  if (res?.lotsDeleted) parts.push(`закупок удалено: ${res.lotsDeleted}`);
  if (res?.lotsKept) parts.push(`материалы изъяты из закупок: ${res.lotsKept}`);
  return parts.join(', ');
}

/** Список заявок с серверными фильтрами и пагинацией (только внутренние роли — см. RequestsPage). */
export function RequestsListTab() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const [openId, setOpenId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [colFilters, setColFilters] = useState<ColumnFilters>({});
  const [peek, setPeek] = useState(false);
  const unread = useUnreadCounts();

  const order = requestsListColumnsStore.useStore((s) => s.order);
  const hidden = requestsListColumnsStore.useStore((s) => s.hidden);
  const groupBy = requestsListColumnsStore.useStore((s) => s.groupBy);
  const prefs = requestsListColumnsStore.resolve(order, hidden);
  const needFull = computeNeedFull(prefs, groupBy, colFilters, peek);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    if (needFull) p.set('all', '1');
    else { p.set('limit', String(pageSize)); p.set('offset', String((page - 1) * pageSize)); }
    return p.toString();
  }, [filters, page, pageSize, needFull]);

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'list', filters, needFull ? 'all' : page, needFull ? 0 : pageSize],
    queryFn: () => api.get<{ data: RequestRow[]; meta: { total: number; truncated?: boolean } }>(`/requests?${qs}`),
  });

  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const truncated = (data?.meta?.truncated ?? false) && needFull;

  const setF = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  async function deleteRequest(r: RequestRow) {
    setDeletingId(r.id);
    try {
      const res = await api.delete<{ data: { lotsDeleted: number; lotsKept: number } }>(`/requests/${r.id}`);
      message.success(deleteResultText(res?.data));
      setOpenId((id) => (id === r.id ? null : id));
      queryClient.removeQueries({ queryKey: ['requests', 'detail', r.id] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchases-registry'] });
      queryClient.invalidateQueries({ queryKey: ['su10-materials'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-lots'] });
    } catch (e) {
      const blocking = parseRequestInPurchase(e);
      if (blocking) {
        modal.warning({
          title: 'Удаление заблокировано',
          width: 520,
          content: (
            <>
              <p>Материалы заявки находятся в активных закупках:</p>
              <ul>
                {blocking.map((o) => (
                  <li key={o.id}>
                    {o.procurementMethod === 'tender' ? 'Тендер' : 'Заказ'} <strong>{o.number}</strong>
                    {' — '}{SOURCING_STATUS_LABELS[o.status as SourcingStatus] ?? o.status}
                    {o.supplier ? ` · ${o.supplier}` : ''}
                  </li>
                ))}
              </ul>
              <p>Сначала отмените или удалите эти заказы в реестре «Заказы».</p>
            </>
          ),
        });
      } else {
        message.error((e as Error).message);
      }
    } finally {
      setDeletingId(null);
    }
  }

  const levelMap = useMemo<Record<string, GroupLevel<RequestRow> | undefined>>(() => ({
    project_name: { key: 'project_name', idOf: (r) => r.project_name ?? 'none', labelOf: (r) => r.project_name || '— Без объекта' },
    contractor_name: { key: 'contractor_name', idOf: (r) => r.contractor_name ?? 'none', labelOf: (r) => r.contractor_name || '— Без подрядчика' },
    request_type: { key: 'request_type', idOf: (r) => r.request_type, labelOf: (r) => MATERIAL_REQUEST_TYPE_LABELS[r.request_type as keyof typeof MATERIAL_REQUEST_TYPE_LABELS] ?? r.request_type },
    status: { key: 'status', idOf: (r) => r.status, labelOf: (r) => REQUEST_STATUS_LABELS[r.status as keyof typeof REQUEST_STATUS_LABELS] ?? r.status },
  }), []);

  const filterSpecs = useMemo(() => ({
    number: { kind: 'text' as const, getText: (r: RequestRow) => r.number },
    created_at: { kind: 'dateRange' as const, getDate: (r: RequestRow) => r.created_at },
    project_name: { kind: 'multi' as const, getText: (r: RequestRow) => r.project_name },
    contractor_name: { kind: 'multi' as const, getText: (r: RequestRow) => r.contractor_name },
    request_type: { kind: 'multi' as const, getText: (r: RequestRow) => r.request_type, labelOf: (v: string) => MATERIAL_REQUEST_TYPE_LABELS[v as keyof typeof MATERIAL_REQUEST_TYPE_LABELS] ?? v },
    status: { kind: 'multi' as const, getText: (r: RequestRow) => r.status, labelOf: (v: string) => REQUEST_STATUS_LABELS[v as keyof typeof REQUEST_STATUS_LABELS] ?? v },
    supplier_name: { kind: 'text' as const, getText: (r: RequestRow) => r.supplier_name },
    order_amount: { kind: 'numRange' as const, getNum: (r: RequestRow) => r.order_amount },
    files_count: { kind: 'numRange' as const, getNum: (r: RequestRow) => r.files_count },
  }), []);

  const gt = useGroupedTable<RequestRow>({
    store: requestsListColumnsStore,
    rows,
    filterSpecs,
    levelMap,
    aggregate: (items) => ({ amount: items.reduce((s, x) => s + Number(x.order_amount ?? 0), 0) }),
    colFilters,
    setColFilters,
    onPeek: () => setPeek(true),
    onChange: () => setPage(1),
  });

  const leaf = (r: Row) => r as RequestRow;
  const leafColumns: ColumnsType<Row> = [
    { title: '', key: 'unread', width: 40, align: 'center', render: (_v, r) => {
      const c = unread[leaf(r).id] || 0;
      return c > 0 ? <Badge count={c} size="small"><MessageOutlined style={{ color: 'var(--est-text-tertiary)' }} /></Badge> : null;
    } },
    { title: 'Номер', key: 'number', width: 120, ...gt.hf('number', filterSpecs.number), render: (_v, r) => <strong>{leaf(r).number}</strong> },
    { title: 'Дата', key: 'created_at', width: 150, ...gt.hf('created_at', filterSpecs.created_at), render: (_v, r) => new Date(leaf(r).created_at).toLocaleString('ru-RU') },
    { title: 'Объект', key: 'project_name', ...gt.hf('project_name', filterSpecs.project_name), render: (_v, r) => leaf(r).project_name || '—' },
    { title: 'Подрядчик', key: 'contractor_name', ...gt.hf('contractor_name', filterSpecs.contractor_name), render: (_v, r) => leaf(r).contractor_name || '—' },
    { title: 'Вид', key: 'request_type', width: 170, ...gt.hf('request_type', filterSpecs.request_type), render: (_v, r) => <RequestTypeTag type={leaf(r).request_type} /> },
    { title: 'Статус', key: 'status', width: 160, ...gt.hf('status', filterSpecs.status), render: (_v, r) => { const row = leaf(r); return <RequestStatusTag status={row.status} comment={row.revision_reason} />; } },
    { title: 'Поставщик', key: 'supplier_name', ...gt.hf('supplier_name', filterSpecs.supplier_name), render: (_v, r) => leaf(r).supplier_name || '—' },
    { title: 'Сумма', key: 'order_amount', width: 130, align: 'right', ...gt.hf('order_amount', filterSpecs.order_amount), render: (_v, r) => money(leaf(r).order_amount) },
    { title: 'Файлы', key: 'files_count', width: 80, align: 'center', ...gt.hf('files_count', filterSpecs.files_count), render: (_v, r) => (Number(leaf(r).files_count) > 0 ? <span><PaperClipOutlined /> {leaf(r).files_count}</span> : '—') },
    ...(isAdmin
      ? ([{
          title: 'Действие', key: 'admin_actions', width: 110, align: 'center',
          onCell: () => ({ onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() }),
          render: (_v: unknown, r: Row) => {
            const row = leaf(r);
            return (
              <ConfirmIconButton
                tooltip="Удалить заявку" title="Удалить заявку?"
                description={deleteDescription(row)}
                onConfirm={() => deleteRequest(row)}
                icon={<DeleteOutlined />} danger loading={deletingId === row.id}
              />
            );
          },
        }] as ColumnsType<Row>)
      : []),
  ];

  const renderGroup = (node: GroupNode<RequestRow>) => (
    <strong>
      {node.label}{' '}
      <span style={{ color: 'var(--est-text-tertiary)', fontWeight: 400 }}>· {node.count} · {money(node.agg.amount ?? 0)}</span>
    </strong>
  );

  const tableData = gt.data;
  const columns = gt.view(leafColumns, renderGroup);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Space wrap style={{ marginBottom: 12, flexShrink: 0, paddingTop: 4, width: '100%' }}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Номер / поставщик" style={{ width: 220 }}
          value={filters.q} onChange={(e) => setF({ q: e.target.value || undefined })} />
        <Select allowClear placeholder="Вид" style={{ width: 200 }} value={filters.type} onChange={(v) => setF({ type: v })}
          options={MATERIAL_REQUEST_TYPES.map((t) => ({ value: t, label: MATERIAL_REQUEST_TYPE_LABELS[t] }))} />
        <Select allowClear placeholder="Статус" style={{ width: 180 }} value={filters.status} onChange={(v) => setF({ status: v })}
          options={REQUEST_STATUSES.map((s) => ({ value: s, label: REQUEST_STATUS_LABELS[s] }))} />
        <DatePicker.RangePicker onChange={(_, ds) => setF({ dateFrom: ds?.[0] || undefined, dateTo: ds?.[1] || undefined })} />
        <Tooltip title="Оформить заявку от имени подрядчика">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/requests/new')}>Новая заявка</Button>
        </Tooltip>
        <div style={{ marginLeft: 'auto' }}>
          <ColumnSettingsButton store={requestsListColumnsStore} />
        </div>
      </Space>
      {truncated && (
        <Alert type="warning" showIcon style={{ marginBottom: 8, flexShrink: 0 }}
          message={`Показаны первые ${rows.length} из ${total}. Отборы и дерево строятся по показанным — сузьте фильтры сверху.`} />
      )}
      <div className="table-page-wrapper">
        <Table<Row>
          rowKey={(r) => (isGroupRow(r) ? r.key : leaf(r).id)}
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={tableData}
          expandable={gt.expandable}
          pagination={needFull
            ? { ...DEFAULT_PAGINATION }
            : { ...DEFAULT_PAGINATION, current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
          scroll={{ x: 1000, y: 'flex' }}
          onRow={(r) => (isGroupRow(r) ? {} : { onClick: () => setOpenId(leaf(r).id), style: { cursor: 'pointer' } })}
          locale={{ emptyText: <Empty description="Заявок нет" /> }}
        />
      </div>

      <RequestDetailModal id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
