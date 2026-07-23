import { useEffect, useMemo, useRef, useState } from 'react';
import { Table, Space, Button, Tooltip, Empty, Badge, Select, Input, Alert, App } from 'antd';
import { FileExcelOutlined, MessageOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import {
  MATERIAL_REQUEST_TYPES,
  MATERIAL_REQUEST_TYPE_LABELS,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
} from '@estimat/shared';
import { api } from '../../services/api';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { type ColumnFilters } from '../../lib/columnFilters';
import { useGroupedTable, computeNeedFull } from '../../lib/useGroupedTable';
import { isGroupRow, type GroupLevel, type GroupNode, type GroupRow } from '../../lib/tableGrouping';
import { ColumnSettingsButton } from '../../components/table/ColumnSettingsButton';
import { CipherTags } from '../../components/CipherTags';
import { contractorRequestsColumnsStore } from './columns/contractorRequestsColumns';
import { RequestStatusTag, RequestTypeTag, money } from '../requests/requestConstants';
import { RequestDetailModal } from '../requests/RequestDetailModal';
import { RequestInfoPopover } from '../requests/RequestInfoPopover';
import { useUnreadCounts } from '../requests/useUnreadCounts';
import type { RequestRow } from '../requests/types';

interface Props {
  estimateId: string;
  /** Подрядчику колонка «Подрядчик» не нужна (все заявки — его). */
  viewerIsContractor: boolean;
  /** Вкладка открыта сейчас. Скрытая остаётся смонтированной — см. обновление списка ниже. */
  active: boolean;
}

interface Filters { type?: string; status?: string; q?: string }
type Row = GroupRow<RequestRow>;

/** Вкладка «Заявки» на странице сметы объекта: заявки только по этому объекту, карточка в окне. */
export function ContractorsRequestsTab({ estimateId, viewerIsContractor, active }: Props) {
  const { message } = App.useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [colFilters, setColFilters] = useState<ColumnFilters>({});
  const [peek, setPeek] = useState(false);
  const unread = useUnreadCounts();

  const order = contractorRequestsColumnsStore.useStore((s) => s.order);
  const hidden = contractorRequestsColumnsStore.useStore((s) => s.hidden);
  const groupBy = contractorRequestsColumnsStore.useStore((s) => s.groupBy);
  const prefs = contractorRequestsColumnsStore.resolve(order, hidden);
  const needFull = computeNeedFull(prefs, groupBy, colFilters, peek);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('estimateId', estimateId);
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    if (needFull) p.set('all', '1');
    else { p.set('limit', String(pageSize)); p.set('offset', String((page - 1) * pageSize)); }
    return p.toString();
  }, [estimateId, filters, page, pageSize, needFull]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['requests', 'by-estimate', estimateId, filters, needFull ? 'all' : page, needFull ? 0 : pageSize],
    queryFn: () => api.get<{ data: RequestRow[]; meta: { total: number; truncated?: boolean } }>(`/requests?${qs}`),
    enabled: !!estimateId,
    // Только у открытой вкладки: скрытая остаётся смонтированной и иначе гоняла бы в фоне запрос
    // всего набора (all=1) на каждый возврат фокуса в окно.
    refetchOnWindowFocus: active,
  });

  // Antd Tabs не размонтирует однажды показанную панель, поэтому возврат на вкладку сам по себе
  // список не перезапрашивает: заявка, созданная на «Материалах» (или другим пользователем),
  // появлялась только после перезагрузки страницы. Первый показ пропускаем — панель монтируется
  // ровно в момент первой активации и грузит запрос сама.
  const shown = useRef(false);
  useEffect(() => {
    if (!active) return;
    if (shown.current) void refetch();
    else shown.current = true;
  }, [active, refetch]);
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const truncated = (data?.meta?.truncated ?? false) && needFull;

  const setF = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  async function exportExcel(r: RequestRow) {
    setDownloadingId(r.id);
    try {
      await api.download(`/requests/${r.id}/export`, {}, `Заявка_${r.number}.xlsx`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  const levelMap = useMemo<Record<string, GroupLevel<RequestRow> | undefined>>(() => ({
    request_type: { key: 'request_type', idOf: (r) => r.request_type, labelOf: (r) => MATERIAL_REQUEST_TYPE_LABELS[r.request_type as keyof typeof MATERIAL_REQUEST_TYPE_LABELS] ?? r.request_type },
    contractor_name: { key: 'contractor_name', idOf: (r) => r.contractor_name ?? 'none', labelOf: (r) => r.contractor_name || '— Без подрядчика' },
    status: { key: 'status', idOf: (r) => r.status, labelOf: (r) => REQUEST_STATUS_LABELS[r.status as keyof typeof REQUEST_STATUS_LABELS] ?? r.status },
  }), []);

  const filterSpecs = useMemo(() => ({
    number: { kind: 'text' as const, getText: (r: RequestRow) => r.number },
    created_at: { kind: 'dateRange' as const, getDate: (r: RequestRow) => r.created_at },
    request_type: { kind: 'multi' as const, getText: (r: RequestRow) => r.request_type, labelOf: (v: string) => MATERIAL_REQUEST_TYPE_LABELS[v as keyof typeof MATERIAL_REQUEST_TYPE_LABELS] ?? v },
    contractor_name: { kind: 'multi' as const, getText: (r: RequestRow) => r.contractor_name },
    status: { kind: 'multi' as const, getText: (r: RequestRow) => r.status, labelOf: (v: string) => REQUEST_STATUS_LABELS[v as keyof typeof REQUEST_STATUS_LABELS] ?? v },
    order_amount: { kind: 'numRange' as const, getNum: (r: RequestRow) => r.order_amount },
    // Шифров у заявки несколько — отбор текстовый по их склейке (поиск по коду находит заявку).
    rd_ciphers: { kind: 'text' as const, getText: (r: RequestRow) => (r.rd_ciphers ?? []).join(' ') },
  }), []);

  const gt = useGroupedTable<RequestRow>({
    store: contractorRequestsColumnsStore,
    rows, filterSpecs, levelMap,
    aggregate: (items) => ({ amount: items.reduce((s, x) => s + Number(x.order_amount ?? 0), 0) }),
    colFilters, setColFilters, onPeek: () => setPeek(true), onChange: () => setPage(1),
  });

  const leaf = (r: Row) => r as RequestRow;
  const leafColumns: ColumnsType<Row> = [
    { title: '', key: 'unread', width: 40, align: 'center', render: (_v, r) => {
      const c = unread[leaf(r).id] || 0;
      return c > 0 ? <Badge count={c} size="small"><MessageOutlined style={{ color: 'var(--est-text-tertiary)' }} /></Badge> : null;
    } },
    { title: 'Номер', key: 'number', width: 110, ...gt.hf('number', filterSpecs.number), render: (_v, r) => <strong>{leaf(r).number}</strong> },
    { title: 'Дата', key: 'created_at', width: 130, ...gt.hf('created_at', filterSpecs.created_at), render: (_v, r) => new Date(leaf(r).created_at).toLocaleString('ru-RU') },
    { title: 'Вид', key: 'request_type', width: 150, ...gt.hf('request_type', filterSpecs.request_type), render: (_v, r) => <RequestTypeTag type={leaf(r).request_type} /> },
    ...(!viewerIsContractor
      ? ([{
          title: 'Подрядчик', key: 'contractor_name', width: 170, ellipsis: { showTitle: true },
          ...gt.hf('contractor_name', filterSpecs.contractor_name),
          render: (_v: unknown, r: Row) => leaf(r).contractor_name || '—',
        }] as ColumnsType<Row>)
      : []),
    {
      title: 'Информация', key: 'info', width: 96, align: 'center',
      // Клик по кнопке не должен открывать карточку заявки (строка кликабельна) — как в «Действиях».
      onCell: () => ({ onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() }),
      render: (_v, r) => {
        const row = leaf(r);
        return (
          <RequestInfoPopover
            requestId={row.id}
            contractorName={row.contractor_name}
            ciphers={row.rd_ciphers ?? []}
          />
        );
      },
    },
    { title: 'Статус', key: 'status', width: 140, ...gt.hf('status', filterSpecs.status), render: (_v, r) => { const row = leaf(r); return <RequestStatusTag status={row.status} comment={row.revision_reason} />; } },
    { title: 'Сумма', key: 'order_amount', width: 120, align: 'right', ...gt.hf('order_amount', filterSpecs.order_amount), render: (_v, r) => money(leaf(r).order_amount) },
    // Единственная колонка без width: при заданном scroll.x она забирает всё свободное место, и
    // длинные перечни шифров перестают ломаться на три строки.
    { title: 'Шифры РД', key: 'rd_ciphers', ...gt.hf('rd_ciphers', filterSpecs.rd_ciphers), render: (_v, r) => <CipherTags codes={leaf(r).rd_ciphers ?? []} /> },
    {
      title: '', key: 'actions', width: 110,
      onCell: () => ({ onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() }),
      render: (_v, r) => {
        const row = leaf(r);
        return (
          <Tooltip title="Выгрузить заявку в Excel">
            <Button size="small" icon={<FileExcelOutlined />} loading={downloadingId === row.id}
              onClick={(e) => { e.stopPropagation(); exportExcel(row); }}>Excel</Button>
          </Tooltip>
        );
      },
    },
  ];

  const renderGroup = (node: GroupNode<RequestRow>) => (
    <strong>{node.label} <span style={{ color: 'var(--est-text-tertiary)', fontWeight: 400 }}>· {node.count} · {money(node.agg.amount ?? 0)}</span></strong>
  );

  const tableData = gt.data;
  const columns = gt.view(leafColumns, renderGroup);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Space wrap style={{ marginBottom: 12, flexShrink: 0, width: '100%' }}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Номер / поставщик" style={{ width: 220 }}
          value={filters.q} onChange={(e) => setF({ q: e.target.value || undefined })} />
        <Select allowClear placeholder="Вид" style={{ width: 200 }} value={filters.type} onChange={(v) => setF({ type: v })}
          options={MATERIAL_REQUEST_TYPES.map((t) => ({ value: t, label: MATERIAL_REQUEST_TYPE_LABELS[t] }))} />
        <Select allowClear placeholder="Статус" style={{ width: 180 }} value={filters.status} onChange={(v) => setF({ status: v })}
          options={REQUEST_STATUSES.map((s) => ({ value: s, label: REQUEST_STATUS_LABELS[s] }))} />
        <div style={{ marginLeft: 'auto' }}>
          <ColumnSettingsButton store={contractorRequestsColumnsStore} />
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
          className="estimat-compact estimat-th-nowrap"
          loading={isLoading}
          columns={columns}
          dataSource={tableData}
          expandable={gt.expandable}
          pagination={needFull
            ? { ...DEFAULT_PAGINATION }
            : { ...DEFAULT_PAGINATION, current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
          scroll={{ x: 1300, y: 'flex' }}
          onRow={(r) => (isGroupRow(r) ? {} : {
            onClick: () => setOpenId(leaf(r).id),
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(leaf(r).id); } },
            tabIndex: 0, style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: <Empty description="Заявок по объекту пока нет" /> }}
        />
      </div>

      <RequestDetailModal id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
