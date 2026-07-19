import { useMemo, useState } from 'react';
import { Table, Space, Segmented, Empty, Tag, Tooltip, Badge, Button, Typography, DatePicker, Alert, App } from 'antd';
import {
  LinkOutlined, SyncOutlined, WarningOutlined, MessageOutlined,
  EditOutlined, StopOutlined, PaperClipOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../services/api';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { hasActiveColumnFilters, type ColumnFilters } from '../../lib/columnFilters';
import { useGroupedTable } from '../../lib/useGroupedTable';
import { isGroupRow, type GroupLevel, type GroupNode, type GroupRow } from '../../lib/tableGrouping';
import { ColumnSettingsButton } from '../../components/table/ColumnSettingsButton';
import { rpRegistryColumnsStore } from './columns/rpRegistryColumns';
import { useUnreadCounts } from './useUnreadCounts';
import { EditRpLetterModal } from './EditRpLetterModal';
import { RequestDetailModal } from './RequestDetailModal';
import type { RequestRow } from './types';

const { Text } = Typography;

type RegFilter = 'all' | 'rp_sent' | 'rp_paid';
type Row = GroupRow<RequestRow>;

const PAY_META: Record<'paid' | 'partial' | 'unpaid', { color: string; label: string }> = {
  paid: { color: 'green', label: 'Оплачено' },
  partial: { color: 'orange', label: 'Частично' },
  unpaid: { color: 'default', label: 'Не оплачено' },
};

function payStatus(r: RequestRow): 'paid' | 'partial' | 'unpaid' {
  const amount = Number(r.order_amount ?? 0);
  const paid = Number(r.order_paid_amount ?? 0);
  if (amount > 0 && paid >= amount) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

const fmtMoney = (v: string | number | null) => `${Number(v ?? 0).toLocaleString('ru-RU')} ₽`;
const fmtDate = (v: string | null) => (v ? dayjs(v).format('DD.MM.YYYY') : '—');

function SentDateCell({ row, onSet }: { row: RequestRow; onSet: (id: string, d: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <DatePicker size="small" open format="DD.MM.YYYY" style={{ width: '100%' }}
        value={row.rp_sent_date ? dayjs(row.rp_sent_date) : null}
        onChange={(d) => { onSet(row.id, d ? d.format('YYYY-MM-DD') : null); setEditing(false); }}
        onOpenChange={(o) => { if (!o) setEditing(false); }} />
    );
  }
  return (
    <a onClick={() => setEditing(true)} style={{ color: row.rp_sent_date ? undefined : '#999' }} title="Изменить дату отправки">
      {row.rp_sent_date ? dayjs(row.rp_sent_date).format('DD.MM.YYYY') : '—'}
    </a>
  );
}

function LetterCell({ row, onRetry }: { row: RequestRow; onRetry: (id: string) => void }) {
  const s = row.rp_sync_status;
  if (!s || s === 'synced') {
    return row.payhub_url ? (
      <a href={row.payhub_url} target="_blank" rel="noopener noreferrer">Открыть <LinkOutlined /></a>
    ) : (<Tag color="green">создано</Tag>);
  }
  if (s === 'pending') return <Tag icon={<SyncOutlined spin />} color="processing">создаётся…</Tag>;
  if (s === 'waiting_config') return <Tag color="warning">ждёт настройки</Tag>;
  if (s === 'failed') {
    return (
      <Space size={4}>
        <Tag icon={<WarningOutlined />} color="error">ошибка</Tag>
        <Button size="small" onClick={() => onRetry(row.id)}>Повторить</Button>
      </Space>
    );
  }
  return <Text type="secondary">—</Text>;
}

function StatusCell({ row }: { row: RequestRow }) {
  const pay = PAY_META[payStatus(row)];
  const synced = !row.rp_sync_status || row.rp_sync_status === 'synced';
  return (
    <Space direction="vertical" size={2}>
      <Tag color={pay.color}>{pay.label}</Tag>
      <Tag color={synced ? 'green' : 'default'}>{synced ? 'Синхронизировано' : 'Черновик'}</Tag>
    </Space>
  );
}

/** Реестр РП: заявки со статусами «РП отправлено» и «РП оплачено» в виде распределительных писем. */
export function RpRegistryTab() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [flt, setFlt] = useState<RegFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [colFilters, setColFilters] = useState<ColumnFilters>({});
  const [editRow, setEditRow] = useState<RequestRow | null>(null);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const unread = useUnreadCounts();

  const order = rpRegistryColumnsStore.useStore((s) => s.order);
  const hidden = rpRegistryColumnsStore.useStore((s) => s.hidden);
  const groupBy = rpRegistryColumnsStore.useStore((s) => s.groupBy);
  const prefs = rpRegistryColumnsStore.resolve(order, hidden);
  const needFull = groupBy.some((k) => !prefs.hidden[k]) || hasActiveColumnFilters(colFilters, prefs.hidden);

  const stopCell = { onCell: () => ({ onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() }) };

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('type', 'own_supplier');
    p.set('status', flt === 'all' ? 'rp_sent,rp_paid' : flt);
    if (needFull) p.set('all', '1');
    else { p.set('limit', String(pageSize)); p.set('offset', String((page - 1) * pageSize)); }
    return p.toString();
  }, [flt, page, pageSize, needFull]);

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'rp-registry', flt, needFull ? 'all' : page, needFull ? 0 : pageSize],
    queryFn: () => api.get<{ data: RequestRow[]; meta: { total: number; truncated?: boolean } }>(`/requests?${qs}`),
    // Автообновление только в плоском режиме: в полном наборе это перезапрос всего набора.
    refetchInterval: (q) => {
      if (needFull) return false;
      const list = q.state.data?.data ?? [];
      return list.some((r) => r.rp_sync_status === 'pending') ? 5000 : false;
    },
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const truncated = (data?.meta?.truncated ?? false) && needFull;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['requests', 'rp-registry'] });

  const setSentDate = async (id: string, d: string | null) => {
    try { await api.patch(`/requests/${id}/rp-sent-date`, { sentDate: d }); invalidate(); }
    catch (e) { message.error((e as Error).message); }
  };
  const retry = async (id: string) => {
    try { await api.post(`/requests/${id}/rp-resync`, {}); message.success('Повторная синхронизация запущена'); invalidate(); }
    catch (e) { message.error((e as Error).message); }
  };
  const annul = (r: RequestRow) => {
    modal.confirm({
      title: 'Аннулировать РП?',
      content: 'Письмо в PayHub будет удалено, заявка вернётся в «Оформление РП» — можно будет переотправить.',
      okText: 'Аннулировать', okButtonProps: { danger: true }, cancelText: 'Отмена',
      onOk: async () => {
        try { await api.post(`/requests/${r.id}/rp-annul`, {}); message.success('РП аннулирована'); invalidate(); }
        catch (e) { message.error((e as Error).message); }
      },
    });
  };

  const levelMap = useMemo<Record<string, GroupLevel<RequestRow> | undefined>>(() => ({
    supplier: { key: 'supplier', idOf: (r) => r.supplier_name ?? 'none', labelOf: (r) => r.supplier_name || '— Без поставщика' },
    contractor: { key: 'contractor', idOf: (r) => r.contractor_name ?? 'none', labelOf: (r) => r.contractor_name || '— Без подрядчика' },
  }), []);

  const filterSpecs = useMemo(() => ({
    number: { kind: 'text' as const, getText: (r: RequestRow) => r.payhub_reg_number || r.rp_number || r.number },
    order_amount: { kind: 'numRange' as const, getNum: (r: RequestRow) => r.order_amount },
    rp_invoice_number: { kind: 'text' as const, getText: (r: RequestRow) => r.rp_invoice_number },
    supplier: { kind: 'multi' as const, getText: (r: RequestRow) => r.supplier_name },
    contractor: { kind: 'multi' as const, getText: (r: RequestRow) => r.contractor_name },
    rp_content: { kind: 'text' as const, getText: (r: RequestRow) => r.rp_content },
  }), []);

  const gt = useGroupedTable<RequestRow>({
    store: rpRegistryColumnsStore,
    filterSpecs, levelMap,
    aggregate: (items) => ({ amount: items.reduce((s, x) => s + Number(x.order_amount ?? 0), 0) }),
    rowsForOptions: rows, colFilters, setColFilters, onChange: () => setPage(1),
  });

  const leaf = (r: Row) => r as RequestRow;
  const leafColumns: ColumnsType<Row> = [
    { title: '', key: 'unread', width: 40, align: 'center', render: (_v, r) => {
      const c = unread[leaf(r).id] || 0;
      return c > 0 ? <Badge count={c} size="small"><MessageOutlined style={{ color: '#8c8c8c' }} /></Badge> : null;
    } },
    { title: '№', key: 'index', width: 44, render: (_v, __, i) => (page - 1) * pageSize + i + 1 },
    { title: 'Номер', key: 'number', width: 160, ...gt.hf('number', filterSpecs.number), render: (_v, r) => {
      const row = leaf(r);
      return (
        <div>
          <div style={{ fontWeight: 600 }}>{row.payhub_reg_number || row.rp_number || <Text type="secondary">—</Text>}</div>
          {row.rp_author && <div style={{ fontSize: 12, color: '#888' }}>{row.rp_author}</div>}
        </div>
      );
    } },
    {
      title: (
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 2 }}>Дата созд.</div>
          <div style={{ paddingTop: 2 }}>Отправки</div>
        </div>
      ),
      key: 'dates', width: 100, ...stopCell,
      render: (_v, r) => {
        const row = leaf(r);
        return (
          <div style={{ lineHeight: 1.3 }}>
            <div>{fmtDate(row.rp_created_at)}</div>
            <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 2, paddingTop: 2 }}>
              <SentDateCell row={row} onSet={setSentDate} />
            </div>
          </div>
        );
      },
    },
    { title: 'Сумма', key: 'order_amount', width: 130, align: 'right', ...gt.hf('order_amount', filterSpecs.order_amount), render: (_v, r) => fmtMoney(leaf(r).order_amount) },
    { title: 'Номер счёта', key: 'rp_invoice_number', width: 100, ...gt.hf('rp_invoice_number', filterSpecs.rp_invoice_number), render: (_v, r) => leaf(r).rp_invoice_number || <Text type="secondary">—</Text> },
    { title: 'Заявка', key: 'request', width: 90, ...stopCell, render: (_v, r) => {
      const row = leaf(r);
      return <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={(e) => { e.stopPropagation(); setOpenRequestId(row.id); }}>{row.number}</Button>;
    } },
    { title: 'Поставщик', key: 'supplier', width: 200, ...gt.hf('supplier', filterSpecs.supplier), render: (_v, r) => {
      const row = leaf(r);
      return row.supplier_name ? (
        <div><div>{row.supplier_name}</div>{row.supplier_inn && <div style={{ fontSize: 12, color: '#888' }}>ИНН: {row.supplier_inn}</div>}</div>
      ) : (<span style={{ color: '#888' }}>—</span>);
    } },
    { title: 'Подрядчик', key: 'contractor', width: 200, ...gt.hf('contractor', filterSpecs.contractor), render: (_v, r) => {
      const row = leaf(r);
      return <div><div>{row.contractor_name || '—'}</div>{row.contractor_inn && <div style={{ fontSize: 12, color: '#888' }}>ИНН: {row.contractor_inn}</div>}</div>;
    } },
    { title: 'Описание', key: 'rp_content', width: 240, ...gt.hf('rp_content', filterSpecs.rp_content), render: (_v, r) => (
      <div style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{leaf(r).rp_content || <Text type="secondary">—</Text>}</div>
    ) },
    { title: 'Письмо', key: 'letter', width: 120, ...stopCell, render: (_v, r) => <LetterCell row={leaf(r)} onRetry={retry} /> },
    { title: 'Статус', key: 'status', width: 150, render: (_v, r) => <StatusCell row={leaf(r)} /> },
    {
      title: 'Действия', key: 'actions', width: 130, fixed: 'right', ...stopCell,
      render: (_v, r) => {
        const row = leaf(r);
        const canAnnul = row.status === 'rp_sent' && payStatus(row) === 'unpaid';
        return (
          <Space size={0}>
            <Tooltip title="Файлы (в карточке заявки)">
              <Badge count={Number(row.files_count) || 0} size="small" color="blue" offset={[-4, 4]}>
                <Button type="text" size="small" icon={<PaperClipOutlined />} onClick={(e) => { e.stopPropagation(); setOpenRequestId(row.id); }} />
              </Badge>
            </Tooltip>
            <Tooltip title="Редактировать письмо">
              <Button type="text" size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); setEditRow(row); }} />
            </Tooltip>
            <Tooltip title={canAnnul ? 'Аннулировать' : 'Аннулировать можно только отправленную неоплаченную РП'}>
              <Button type="text" size="small" icon={<StopOutlined />} disabled={!canAnnul} onClick={(e) => { e.stopPropagation(); annul(row); }} />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  const renderGroup = (node: GroupNode<RequestRow>) => (
    <strong>{node.label} <span style={{ color: '#8c8c8c', fontWeight: 400 }}>· {node.count} · {fmtMoney(node.agg.amount ?? 0)}</span></strong>
  );

  const tableData = gt.buildData(rows);
  const columns = gt.view(leafColumns, renderGroup);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Space style={{ marginBottom: 12, flexShrink: 0, paddingTop: 4, width: '100%' }}>
        <Segmented value={flt} onChange={(v) => { setFlt(v as RegFilter); setPage(1); }}
          options={[{ value: 'all', label: 'Все' }, { value: 'rp_sent', label: 'РП отправлено' }, { value: 'rp_paid', label: 'РП оплачено' }]} />
        <div style={{ marginLeft: 'auto' }}>
          <ColumnSettingsButton store={rpRegistryColumnsStore} />
        </div>
      </Space>
      {truncated && (
        <Alert type="warning" showIcon style={{ marginBottom: 8, flexShrink: 0 }}
          message={`Показаны первые ${rows.length} из ${total}. Отборы и дерево строятся по показанным — сузьте фильтры.`} />
      )}
      <div className="table-page-wrapper">
        <Table<Row>
          rowKey={(r) => (isGroupRow(r) ? r.key : leaf(r).id)}
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={tableData}
          expandable={gt.treeMode ? { expandedRowKeys: gt.expandedKeys(tableData) } : undefined}
          pagination={needFull
            ? { ...DEFAULT_PAGINATION }
            : { ...DEFAULT_PAGINATION, current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
          scroll={{ x: 1500, y: 'flex' }}
          onRow={(r) => (isGroupRow(r) ? {} : { onClick: () => setOpenRequestId(leaf(r).id), style: { cursor: 'pointer' } })}
          locale={{ emptyText: <Empty description="В реестре пока нет РП" /> }}
        />
      </div>
      <EditRpLetterModal open={!!editRow} letter={editRow} onClose={() => setEditRow(null)} onSaved={invalidate} />
      <RequestDetailModal id={openRequestId} onClose={() => setOpenRequestId(null)} />
    </div>
  );
}
