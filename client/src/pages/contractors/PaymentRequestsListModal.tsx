import { Modal, Table, Tag, Button, Empty, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import {
  PAYMENT_REQUEST_STATUS_LABELS,
  PAYMENT_PAID_STATUS_LABELS,
  type PaymentRequestStatus,
  type PaymentPaidStatus,
} from '@estimat/shared';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';

interface PaymentRequestRow {
  id: string;
  bh_request_number: string | null;
  bh_request_url: string | null;
  lifecycle_state: string;
  status_code: string | null;
  action_required: boolean;
  revision_comment: string | null;
  rp_number: string | null;
  paid_status: string | null;
  total_paid: string | null;
  invoice_amount: string | null;
  bh_supplier_name: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_COLOR: Record<PaymentRequestStatus, string> = {
  approv_shtab: 'processing',
  approv_omts: 'processing',
  approv_rp: 'processing',
  approved: 'success',
  revision: 'warning',
  rejected: 'error',
  withdrawn: 'default',
};

const money = (v: string | null) => (v == null ? '—' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2 }));

// URL приходит из внешней системы (BillHub) — в href допускаем только http(s),
// иначе javascript:-URL выполнил бы код по клику (XSS).
const safeHref = (u: string | null): string | null =>
  u && /^https?:\/\//i.test(u) ? u : null;

export function PaymentRequestsListModal({ open, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['payment-requests'],
    queryFn: () => api.get<{ data: PaymentRequestRow[] }>('/payment-requests'),
    enabled: open,
  });

  const rows = data?.data ?? [];

  const columns: ColumnsType<PaymentRequestRow> = [
    {
      title: 'Номер',
      key: 'number',
      width: 140,
      render: (_, r) => {
        const href = safeHref(r.bh_request_url);
        return href ? (
          <a href={href} target="_blank" rel="noreferrer">{r.bh_request_number ?? '—'}</a>
        ) : (
          r.bh_request_number ?? <span style={{ color: '#bfbfbf' }}>не отправлена</span>
        );
      },
    },
    { title: 'Поставщик', dataIndex: 'bh_supplier_name', key: 'supplier', render: (v: string | null) => v || '—' },
    { title: 'Сумма, ₽', key: 'amount', width: 130, align: 'right', render: (_, r) => money(r.invoice_amount) },
    {
      title: 'Статус согласования',
      key: 'status',
      width: 190,
      render: (_, r) => {
        if (!r.status_code) {
          return <Tag>{r.lifecycle_state === 'submitted' ? 'Отправляется…' : 'Черновик'}</Tag>;
        }
        const label = PAYMENT_REQUEST_STATUS_LABELS[r.status_code as PaymentRequestStatus] ?? r.status_code;
        const tag = <Tag color={STATUS_COLOR[r.status_code as PaymentRequestStatus]}>{label}</Tag>;
        return r.status_code === 'revision' && r.revision_comment ? (
          <Tooltip title={r.revision_comment}>{tag}</Tooltip>
        ) : (
          tag
        );
      },
    },
    {
      title: 'Оплата',
      key: 'paid',
      width: 150,
      render: (_, r) =>
        r.paid_status ? (
          <Tag color={r.paid_status === 'paid' ? 'green' : r.paid_status === 'partially_paid' ? 'gold' : 'default'}>
            {PAYMENT_PAID_STATUS_LABELS[r.paid_status as PaymentPaidStatus] ?? r.paid_status}
          </Tag>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
    { title: 'РП', dataIndex: 'rp_number', key: 'rp', width: 120, render: (v: string | null) => v || '—' },
    {
      title: 'Создана',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (v: string) => new Date(v).toLocaleString('ru-RU'),
    },
  ];

  return (
    <Modal
      title="Заявки на оплату"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
      width={modalWidth(1100)}
    >
      <Table<PaymentRequestRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        pagination={DEFAULT_PAGINATION}
        scroll={{ x: 980 }}
        locale={{ emptyText: <Empty description="Заявок на оплату пока нет" /> }}
      />
    </Modal>
  );
}
