import { useMemo, useState } from 'react';
import { Table, Space, Button, Tooltip, Empty, Modal, Badge, Select, Input, App } from 'antd';
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
import { modalWidth } from '../../lib/modalWidth';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { RequestStatusTag, RequestTypeTag, money } from '../requests/requestConstants';
import { RequestDetailContent } from '../requests/RequestDetailContent';
import { useUnreadCounts } from '../requests/useUnreadCounts';
import type { RequestRow } from '../requests/types';

interface Props {
  estimateId: string;
  /** Подрядчику колонка «Подрядчик» не нужна (все заявки — его). */
  viewerIsContractor: boolean;
}

interface Filters {
  type?: string;
  status?: string;
  q?: string;
}

/** Вкладка «Заявки» на странице сметы объекта: заявки только по этому объекту, карточка в окне. */
export function ContractorsRequestsTab({ estimateId, viewerIsContractor }: Props) {
  const { message } = App.useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const unread = useUnreadCounts();

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('estimateId', estimateId);
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    p.set('limit', String(pageSize));
    p.set('offset', String((page - 1) * pageSize));
    return p.toString();
  }, [estimateId, filters, page, pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'by-estimate', estimateId, filters, page, pageSize],
    queryFn: () => api.get<{ data: RequestRow[]; meta: { total: number } }>(`/requests?${qs}`),
    enabled: !!estimateId,
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const setF = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

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

  const columns: ColumnsType<RequestRow> = [
    { title: '', key: 'unread', width: 40, align: 'center', render: (_, r) => {
      const c = unread[r.id] || 0;
      return c > 0 ? <Badge count={c} size="small"><MessageOutlined style={{ color: '#8c8c8c' }} /></Badge> : null;
    } },
    { title: 'Номер', dataIndex: 'number', key: 'number', width: 120, render: (v: string) => <strong>{v}</strong> },
    {
      title: 'Дата', dataIndex: 'created_at', key: 'created_at', width: 150,
      render: (v: string) => new Date(v).toLocaleString('ru-RU'),
    },
    {
      title: 'Вид', dataIndex: 'request_type', key: 'request_type', width: 170,
      render: (v: string) => <RequestTypeTag type={v} />,
    },
    ...(!viewerIsContractor
      ? ([{
          title: 'Подрядчик', dataIndex: 'contractor_name', key: 'contractor_name',
          render: (v: string | null) => v || '—',
        }] as ColumnsType<RequestRow>)
      : []),
    {
      title: 'Статус', dataIndex: 'status', key: 'status', width: 160,
      render: (_, r) => <RequestStatusTag status={r.status} comment={r.revision_reason} />,
    },
    {
      title: 'Сумма', dataIndex: 'order_amount', key: 'order_amount', width: 130, align: 'right',
      render: (v: string | number | null) => money(v),
    },
    {
      title: '', key: 'actions', width: 110,
      render: (_, r) => (
        <Tooltip title="Выгрузить заявку в Excel">
          <Button
            size="small" icon={<FileExcelOutlined />}
            loading={downloadingId === r.id}
            onClick={(e) => { e.stopPropagation(); exportExcel(r); }}
          >
            Excel
          </Button>
        </Tooltip>
      ),
    },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Номер / поставщик"
          style={{ width: 220 }}
          value={filters.q}
          onChange={(e) => setF({ q: e.target.value || undefined })}
        />
        <Select
          allowClear placeholder="Вид" style={{ width: 200 }}
          value={filters.type}
          onChange={(v) => setF({ type: v })}
          options={MATERIAL_REQUEST_TYPES.map((t) => ({ value: t, label: MATERIAL_REQUEST_TYPE_LABELS[t] }))}
        />
        <Select
          allowClear placeholder="Статус" style={{ width: 180 }}
          value={filters.status}
          onChange={(v) => setF({ status: v })}
          options={REQUEST_STATUSES.map((s) => ({ value: s, label: REQUEST_STATUS_LABELS[s] }))}
        />
      </Space>
      <Table<RequestRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        pagination={{
          ...DEFAULT_PAGINATION,
          current: page,
          pageSize,
          total,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        scroll={{ x: 900 }}
        onRow={(r) => ({
          onClick: () => setOpenId(r.id),
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(r.id); } },
          tabIndex: 0,
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: <Empty description="Заявок по объекту пока нет" /> }}
      />

      <Modal
        open={!!openId}
        onCancel={() => setOpenId(null)}
        footer={null}
        width={modalWidth(1000)}
        style={{ top: 20 }}
        styles={{ body: { height: 'calc(90vh - 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 12 } }}
        destroyOnClose
      >
        {openId && <RequestDetailContent id={openId} onBack={() => setOpenId(null)} />}
      </Modal>
    </div>
  );
}
