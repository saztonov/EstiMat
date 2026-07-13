import { useMemo, useState } from 'react';
import { Table, Space, Select, Input, DatePicker, Empty, Button, Tooltip, Badge, Popconfirm, Modal, App } from 'antd';
import { SearchOutlined, PaperClipOutlined, FileExcelOutlined, MessageOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUnreadCounts } from './useUnreadCounts';
import {
  MATERIAL_REQUEST_TYPES,
  MATERIAL_REQUEST_TYPE_LABELS,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { modalWidth } from '../../lib/modalWidth';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { RequestStatusTag, RequestTypeTag, money } from './requestConstants';
import { RequestDetailContent } from './RequestDetailContent';
import type { RequestRow } from './types';

interface Filters {
  type?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Список заявок с серверными фильтрами и пагинацией. Для подрядчика — колонка «Excel». */
export function RequestsListTab() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isSupply = role === 'engineer' || role === 'admin' || role === 'manager';
  const isAdmin = role === 'admin';
  const [openId, setOpenId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const unread = useUnreadCounts();

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    p.set('limit', String(pageSize));
    p.set('offset', String((page - 1) * pageSize));
    return p.toString();
  }, [filters, page, pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'list', filters, page, pageSize],
    queryFn: () => api.get<{ data: RequestRow[]; meta: { total: number } }>(`/requests?${qs}`),
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

  async function deleteRequest(r: RequestRow) {
    setDeletingId(r.id);
    try {
      await api.delete(`/requests/${r.id}`);
      message.success('Заявка удалена');
      queryClient.invalidateQueries({ queryKey: ['requests', 'list'] });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDeletingId(null);
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
    { title: 'Объект', dataIndex: 'project_name', key: 'project_name', render: (v: string | null) => v || '—' },
    ...(isSupply
      ? ([{
          title: 'Подрядчик', dataIndex: 'contractor_name', key: 'contractor_name',
          render: (v: string | null) => v || '—',
        }] as ColumnsType<RequestRow>)
      : []),
    {
      title: 'Вид', dataIndex: 'request_type', key: 'request_type', width: 170,
      render: (v: string) => <RequestTypeTag type={v} />,
    },
    {
      title: 'Статус', dataIndex: 'status', key: 'status', width: 160,
      render: (_, r) => <RequestStatusTag status={r.status} comment={r.revision_reason} />,
    },
    { title: 'Поставщик', dataIndex: 'supplier_name', key: 'supplier_name', render: (v: string | null) => v || '—' },
    {
      title: 'Сумма', dataIndex: 'order_amount', key: 'order_amount', width: 130, align: 'right',
      render: (v: string | number | null) => money(v),
    },
    {
      title: 'Файлы', dataIndex: 'files_count', key: 'files_count', width: 80, align: 'center',
      render: (v: number | string) => (Number(v) > 0 ? <span><PaperClipOutlined /> {v}</span> : '—'),
    },
    ...(!isSupply
      ? ([{
          title: '', key: 'actions', width: 110,
          render: (_: unknown, r: RequestRow) => (
            <Tooltip title="Выгрузить заявку в Excel">
              <Button
                size="small"
                icon={<FileExcelOutlined />}
                loading={downloadingId === r.id}
                onClick={(e) => { e.stopPropagation(); exportExcel(r); }}
              >
                Excel
              </Button>
            </Tooltip>
          ),
        }] as ColumnsType<RequestRow>)
      : []),
    ...(isAdmin
      ? ([{
          title: 'Действие', key: 'admin_actions', width: 110, align: 'center',
          render: (_: unknown, r: RequestRow) => (
            <Popconfirm
              title="Удалить заявку?"
              description="Заявка, документы и позиции лотов будут удалены без возможности восстановления."
              okText="Удалить" okButtonProps={{ danger: true }} cancelText="Отмена"
              onConfirm={() => deleteRequest(r)}
            >
              <Tooltip title="Удалить заявку">
                <Button
                  danger size="small"
                  icon={<DeleteOutlined />}
                  loading={deletingId === r.id}
                  onClick={(e) => e.stopPropagation()}
                />
              </Tooltip>
            </Popconfirm>
          ),
        }] as ColumnsType<RequestRow>)
      : []),
  ];

  return (
    <>
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
        <DatePicker.RangePicker
          onChange={(_, ds) => setF({ dateFrom: ds?.[0] || undefined, dateTo: ds?.[1] || undefined })}
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
        scroll={{ x: 1000 }}
        onRow={(r) => ({ onClick: () => setOpenId(r.id), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty description="Заявок нет" /> }}
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
    </>
  );
}
