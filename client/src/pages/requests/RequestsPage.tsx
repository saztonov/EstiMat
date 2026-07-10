import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, Table, Space, Select, Input, DatePicker, Empty } from 'antd';
import { SearchOutlined, PaperClipOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import {
  MATERIAL_REQUEST_TYPES,
  MATERIAL_REQUEST_TYPE_LABELS,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { RequestStatusTag, RequestTypeTag, money } from './requestConstants';
import type { RequestRow } from './types';

interface Filters {
  type?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function RequestsPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isSupply = role === 'engineer' || role === 'admin' || role === 'manager';
  const [filters, setFilters] = useState<Filters>({});

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [filters]);

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'list', filters],
    queryFn: () => api.get<{ data: RequestRow[]; meta: { total: number } }>(`/requests${qs ? `?${qs}` : ''}`),
  });

  const rows = data?.data ?? [];

  const columns: ColumnsType<RequestRow> = [
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
      title: 'Вид', dataIndex: 'request_type', key: 'request_type', width: 180,
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
  ];

  return (
    <Card
      title="Заявки"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ header: { paddingLeft: 48 }, body: { flex: 1, minHeight: 0, overflow: 'auto' } }}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Номер / поставщик"
          style={{ width: 220 }}
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))}
        />
        <Select
          allowClear placeholder="Вид" style={{ width: 200 }}
          value={filters.type}
          onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
          options={MATERIAL_REQUEST_TYPES.map((t) => ({ value: t, label: MATERIAL_REQUEST_TYPE_LABELS[t] }))}
        />
        <Select
          allowClear placeholder="Статус" style={{ width: 180 }}
          value={filters.status}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          options={REQUEST_STATUSES.map((s) => ({ value: s, label: REQUEST_STATUS_LABELS[s] }))}
        />
        <DatePicker.RangePicker
          onChange={(_, ds) => setFilters((f) => ({ ...f, dateFrom: ds?.[0] || undefined, dateTo: ds?.[1] || undefined }))}
        />
      </Space>
      <Table<RequestRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        pagination={DEFAULT_PAGINATION}
        scroll={{ x: 1000 }}
        onRow={(r) => ({ onClick: () => navigate(`/requests/${r.id}`), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty description="Заявок нет" /> }}
      />
    </Card>
  );
}
