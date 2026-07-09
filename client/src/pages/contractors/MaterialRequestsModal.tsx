import { useState } from 'react';
import { Modal, Table, Tag, Button, Empty, Space, Tooltip, App } from 'antd';
import { FileExcelOutlined, DollarOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import {
  MATERIAL_REQUEST_STATUS_LABELS,
  MATERIAL_REQUEST_TYPE_LABELS,
  type MaterialRequestStatus,
} from '@estimat/shared';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { PaymentRequestModal } from './PaymentRequestModal';

interface RequestItem {
  name: string;
  unit: string;
  quantity: number | string;
  costTypeName: string | null;
}

interface MaterialRequestRow {
  id: string;
  request_no: number | null;
  number: string;
  status: string;
  request_type: string;
  created_at: string;
  project_code: string | null;
  project_name: string | null;
  contractor_name: string | null;
  items: RequestItem[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  /** Подрядчику колонка «Подрядчик» не нужна (все заявки — его). */
  viewerIsContractor: boolean;
}

const STATUS_COLOR: Record<MaterialRequestStatus, string> = {
  created: 'default',
  sent: 'blue',
  rp_created: 'orange',
  paid: 'green',
};

const num = (v: number | string | null | undefined) => Number(v ?? 0);

function ItemsTable({ items }: { items: RequestItem[] }) {
  const columns: ColumnsType<RequestItem> = [
    { title: 'Вид работ', dataIndex: 'costTypeName', key: 'costTypeName', render: (v: string | null) => v || '—' },
    { title: 'Материал', dataIndex: 'name', key: 'name' },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 80 },
    {
      title: 'Кол-во',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 110,
      align: 'right',
      render: (v) => Math.round(num(v) * 1e4) / 1e4,
    },
  ];
  return (
    <Table<RequestItem>
      rowKey={(_, i) => String(i)}
      size="small"
      pagination={false}
      columns={columns}
      dataSource={items}
      scroll={{ x: 520 }}
    />
  );
}

export function MaterialRequestsModal({ open, onClose, estimateId, viewerIsContractor }: Props) {
  const { message } = App.useApp();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<MaterialRequestRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['material-requests', estimateId],
    queryFn: () =>
      api.get<{ data: MaterialRequestRow[] }>(
        `/material-requests?estimateId=${encodeURIComponent(estimateId)}`,
      ),
    enabled: open && !!estimateId,
  });

  const rows = data?.data ?? [];
  const projectName = rows[0]?.project_name ?? null;

  async function exportExcel(r: MaterialRequestRow) {
    setDownloadingId(r.id);
    try {
      await api.download(`/material-requests/${r.id}/export`, {}, `Заявка_${r.number}.xlsx`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  const columns: ColumnsType<MaterialRequestRow> = [
    { title: 'Номер', dataIndex: 'number', key: 'number', width: 120, render: (v: string) => <strong>{v}</strong> },
    {
      title: 'Дата',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (v: string) => new Date(v).toLocaleString('ru-RU'),
    },
    {
      title: 'Тип',
      dataIndex: 'request_type',
      key: 'request_type',
      width: 150,
      render: (v: string) => MATERIAL_REQUEST_TYPE_LABELS[v as keyof typeof MATERIAL_REQUEST_TYPE_LABELS] ?? v,
    },
    ...(!viewerIsContractor
      ? ([{
          title: 'Подрядчик',
          dataIndex: 'contractor_name',
          key: 'contractor_name',
          render: (v: string | null) => v || '—',
        }] as ColumnsType<MaterialRequestRow>)
      : []),
    {
      title: 'Материалов',
      key: 'count',
      width: 100,
      align: 'right',
      render: (_, r) => r.items.length,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: string) => (
        <Tag color={STATUS_COLOR[s as MaterialRequestStatus]}>
          {MATERIAL_REQUEST_STATUS_LABELS[s as MaterialRequestStatus] ?? s}
        </Tag>
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 220,
      render: (_, r) =>
        r.request_type === 'own_supplier' ? (
          <Space size={4} wrap>
            <Tooltip title="Выгрузить заявку в Excel для поставщика">
              <Button
                size="small"
                icon={<FileExcelOutlined />}
                loading={downloadingId === r.id}
                onClick={() => exportExcel(r)}
              >
                Excel
              </Button>
            </Tooltip>
            {viewerIsContractor && (
              <Button size="small" type="primary" icon={<DollarOutlined />} onClick={() => setPayFor(r)}>
                Заявка на оплату
              </Button>
            )}
          </Space>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
  ];

  return (
    <>
      <Modal
        title={`Созданные заявки${projectName ? ` — ${projectName}` : ''}`}
        open={open}
        onCancel={onClose}
        footer={<Button onClick={onClose}>Закрыть</Button>}
        width={modalWidth(1000)}
      >
        <Table<MaterialRequestRow>
          rowKey="id"
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={rows}
          pagination={DEFAULT_PAGINATION}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description="Заявок пока нет" /> }}
          expandable={{
            expandedRowRender: (r) => <ItemsTable items={r.items} />,
            rowExpandable: (r) => r.items.length > 0,
          }}
        />
      </Modal>
      {payFor && (
        <PaymentRequestModal
          open
          materialRequestId={payFor.id}
          materialRequestNumber={payFor.number}
          onClose={() => setPayFor(null)}
        />
      )}
    </>
  );
}
