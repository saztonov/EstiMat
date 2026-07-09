import { Modal, Table, Tag, Button, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import {
  MATERIAL_REQUEST_STATUS_LABELS,
  type MaterialRequestStatus,
} from '@estimat/shared';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';

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
  sent: 'blue',
  rp_created: 'orange',
  paid: 'green',
};

const num = (v: number | string | null | undefined) => Number(v ?? 0);

// Вложенная таблица состава заявки: вид работ / материал / ед. / количество.
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

  const columns: ColumnsType<MaterialRequestRow> = [
    { title: 'Номер', dataIndex: 'number', key: 'number', width: 130, render: (v: string) => <strong>{v}</strong> },
    {
      title: 'Дата',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('ru-RU'),
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
      width: 110,
      align: 'right',
      render: (_, r) => r.items.length,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (s: string) => (
        <Tag color={STATUS_COLOR[s as MaterialRequestStatus]}>
          {MATERIAL_REQUEST_STATUS_LABELS[s as MaterialRequestStatus] ?? s}
        </Tag>
      ),
    },
  ];

  return (
    <Modal
      title={`Созданные заявки${projectName ? ` — ${projectName}` : ''}`}
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
      width={modalWidth(900)}
    >
      <Table<MaterialRequestRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        pagination={DEFAULT_PAGINATION}
        scroll={{ x: 700 }}
        locale={{ emptyText: <Empty description="Заявок пока нет" /> }}
        expandable={{
          expandedRowRender: (r) => <ItemsTable items={r.items} />,
          rowExpandable: (r) => r.items.length > 0,
        }}
      />
    </Modal>
  );
}
