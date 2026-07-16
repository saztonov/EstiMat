import { useMemo, useState } from 'react';
import { Table, Space, Select, Input, DatePicker, Empty, Button, Tooltip, Badge, App } from 'antd';
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
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { ConfirmIconButton } from '../../components/shared/ConfirmIconButton';
import { RequestStatusTag, RequestTypeTag, money } from './requestConstants';
import { RequestDetailModal } from './RequestDetailModal';
import type { RequestRow } from './types';

interface Filters {
  type?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

const DELETE_BASE_TEXT = 'Заявка, документы и позиции заказов будут удалены без возможности восстановления.';

/** Материалы заявки в активной закупке — удалить можно, но админ должен видеть последствия. */
function deleteDescription(r: RequestRow) {
  if (!r.in_active_purchase) return DELETE_BASE_TEXT;
  return (
    <>
      <strong>Материалы заявки участвуют в активной закупке</strong> — они будут из неё изъяты,
      сама закупка сохранится. {DELETE_BASE_TEXT}
    </>
  );
}

/** Итог удаления: сколько закупок ушло вместе с заявкой, а сколько осталось (активные — не удаляем). */
function deleteResultText(res?: { lotsDeleted: number; lotsKept: number }): string {
  const parts = ['Заявка удалена'];
  if (res?.lotsDeleted) parts.push(`закупок удалено: ${res.lotsDeleted}`);
  if (res?.lotsKept) parts.push(`материалы изъяты из закупок: ${res.lotsKept}`);
  return parts.join(', ');
}

/** Список заявок с серверными фильтрами и пагинацией (только внутренние роли — см. RequestsPage). */
export function RequestsListTab() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const [openId, setOpenId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
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

  async function deleteRequest(r: RequestRow) {
    setDeletingId(r.id);
    try {
      const res = await api.delete<{ data: { lotsDeleted: number; lotsKept: number } }>(`/requests/${r.id}`);
      message.success(deleteResultText(res?.data));
      // Карточку удалённой заявки не показываем: закрываем её и убираем ответ из кэша.
      setOpenId((id) => (id === r.id ? null : id));
      queryClient.removeQueries({ queryKey: ['requests', 'detail', r.id] });
      // Удаление заявки меняет и реестр закупок, и свод материалов.
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchases-registry'] });
      queryClient.invalidateQueries({ queryKey: ['su10-materials'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-lots'] });
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
    {
      title: 'Подрядчик', dataIndex: 'contractor_name', key: 'contractor_name',
      render: (v: string | null) => v || '—',
    },
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
    ...(isAdmin
      ? ([{
          title: 'Действие', key: 'admin_actions', width: 110, align: 'center',
          render: (_: unknown, r: RequestRow) => (
            <ConfirmIconButton
              tooltip="Удалить заявку"
              title="Удалить заявку?"
              description={deleteDescription(r)}
              onConfirm={() => deleteRequest(r)}
              icon={<DeleteOutlined />}
              danger
              loading={deletingId === r.id}
            />
          ),
        }] as ColumnsType<RequestRow>)
      : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Space wrap style={{ marginBottom: 12, flexShrink: 0, paddingTop: 4 }}>
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
        {/* Набор идёт по смете — там же, где его ведёт подрядчик: свод материалов, группировки и
            массовый набор. Здесь только вход в него. */}
        <Tooltip title="Оформить заявку от имени подрядчика">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/requests/new')}>
            Новая заявка
          </Button>
        </Tooltip>
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
        scroll={{ x: 1000, y: 'flex' }}
        onRow={(r) => ({ onClick: () => setOpenId(r.id), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty description="Заявок нет" /> }}
      />

      <RequestDetailModal id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
