import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Table, Space, Segmented, Empty, Tag, Tooltip } from 'antd';
import { LinkOutlined, SyncOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { money } from './requestConstants';
import type { RequestRow } from './types';

type RegFilter = 'all' | 'rp_sent' | 'rp_paid';

const PAID_TAG: Record<string, { color: string; label: string }> = {
  rp_sent: { color: 'processing', label: 'Не оплачено' },
  rp_paid: { color: 'green', label: 'Оплачено' },
};

function SyncTag({ status }: { status: string | null }) {
  if (!status || status === 'synced') {
    return <Tooltip title="Письмо синхронизировано с PayHub"><Tag icon={<CheckCircleOutlined />} color="green">В PayHub</Tag></Tooltip>;
  }
  if (status === 'failed') {
    return <Tooltip title="Ошибка синхронизации вложений — откройте заявку и повторите"><Tag icon={<WarningOutlined />} color="error">Ошибка</Tag></Tooltip>;
  }
  return <Tooltip title="Синхронизация вложений выполняется"><Tag icon={<SyncOutlined spin />} color="processing">Отправка…</Tag></Tooltip>;
}

/** Реестр РП: заявки со статусами «РП отправлено» и «РП оплачено». */
export function RpRegistryTab() {
  const navigate = useNavigate();
  const [flt, setFlt] = useState<RegFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('type', 'own_supplier');
    p.set('status', flt === 'all' ? 'rp_sent,rp_paid' : flt);
    p.set('limit', String(pageSize));
    p.set('offset', String((page - 1) * pageSize));
    return p.toString();
  }, [flt, page, pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'rp-registry', flt, page, pageSize],
    queryFn: () => api.get<{ data: RequestRow[]; meta: { total: number } }>(`/requests?${qs}`),
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const columns: ColumnsType<RequestRow> = [
    {
      title: '№ РП', dataIndex: 'payhub_reg_number', key: 'reg', width: 150,
      render: (v: string | null, r) => <strong>{v || r.rp_number || '—'}</strong>,
    },
    {
      title: 'Дата РП', dataIndex: 'rp_date', key: 'rp_date', width: 120,
      render: (v: string | null) => (v ? new Date(v).toLocaleDateString('ru-RU') : '—'),
    },
    { title: 'Объект', dataIndex: 'project_name', key: 'project_name', render: (v: string | null) => v || '—' },
    { title: 'Подрядчик', dataIndex: 'contractor_name', key: 'contractor_name', render: (v: string | null) => v || '—' },
    { title: 'Поставщик', dataIndex: 'supplier_name', key: 'supplier_name', render: (v: string | null) => v || '—' },
    {
      title: 'Сумма', dataIndex: 'order_amount', key: 'order_amount', width: 130, align: 'right',
      render: (v: string | number | null) => money(v),
    },
    {
      title: 'Оплата', dataIndex: 'status', key: 'paid', width: 130,
      render: (s: string) => {
        const t = PAID_TAG[s] ?? { color: 'default', label: s };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: 'PayHub', key: 'sync', width: 130,
      render: (_, r) => (
        <Space size={4}>
          <SyncTag status={r.rp_sync_status} />
          {r.payhub_url && (
            <a href={r.payhub_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
              <LinkOutlined />
            </a>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Segmented
          value={flt}
          onChange={(v) => { setFlt(v as RegFilter); setPage(1); }}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'rp_sent', label: 'РП отправлено' },
            { value: 'rp_paid', label: 'РП оплачено' },
          ]}
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
        onRow={(r) => ({ onClick: () => navigate(`/requests/${r.id}`), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty description="В реестре пока нет РП" /> }}
      />
    </>
  );
}
