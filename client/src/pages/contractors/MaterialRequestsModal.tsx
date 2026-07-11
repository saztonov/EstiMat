import { useState } from 'react';
import { Modal, Table, Tag, Button, Empty, Space, Tooltip, App } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import {
  REQUEST_STATUS_LABELS,
  MATERIAL_REQUEST_TYPE_LABELS,
  type RequestStatus,
} from '@estimat/shared';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { RequestDetailContent } from '../requests/RequestDetailContent';

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

const STATUS_COLOR: Record<RequestStatus, string> = {
  in_work: 'processing',
  revision: 'warning',
  supplier_selected: 'blue',
  paid: 'green',
  delivered: 'success',
};

export function MaterialRequestsModal({ open, onClose, estimateId, viewerIsContractor }: Props) {
  const { message } = App.useApp();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Открытая во вложенной модалке карточка заявки.
  const [openId, setOpenId] = useState<string | null>(null);

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
      width: 150,
      render: (s: string) => (
        <Tag color={STATUS_COLOR[s as RequestStatus]}>
          {REQUEST_STATUS_LABELS[s as RequestStatus] ?? s}
        </Tag>
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 220,
      render: (_, r) => (
        <Space size={4} wrap>
          <Button size="small" type="link" onClick={() => setOpenId(r.id)}>
            Открыть
          </Button>
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
        </Space>
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
        />
      </Modal>

      {/* Карточка заявки поверх списка — по кнопке «Открыть» */}
      <Modal
        open={!!openId}
        onCancel={() => setOpenId(null)}
        footer={null}
        width={modalWidth(1000)}
        destroyOnClose
      >
        {openId && <RequestDetailContent id={openId} onBack={() => setOpenId(null)} />}
      </Modal>
    </>
  );
}
