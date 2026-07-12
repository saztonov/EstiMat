import { useState } from 'react';
import { Table, Space, Button, Tooltip, Empty, Modal, Badge, App } from 'antd';
import { FileExcelOutlined, MessageOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
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

/** Вкладка «Заявки» на странице сметы объекта: заявки только по этому объекту, карточка в окне. */
export function ContractorsRequestsTab({ estimateId, viewerIsContractor }: Props) {
  const { message } = App.useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const unread = useUnreadCounts();

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'by-estimate', estimateId],
    queryFn: () =>
      api.get<{ data: RequestRow[] }>(`/requests?estimateId=${encodeURIComponent(estimateId)}&limit=500`),
    enabled: !!estimateId,
  });
  const rows = data?.data ?? [];

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
      title: 'Действия', key: 'actions', width: 200,
      render: (_, r) => (
        <Space size={4} wrap>
          <Button size="small" type="link" onClick={() => setOpenId(r.id)}>Открыть</Button>
          <Tooltip title="Выгрузить заявку в Excel">
            <Button
              size="small" icon={<FileExcelOutlined />}
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
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Table<RequestRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        pagination={DEFAULT_PAGINATION}
        scroll={{ x: 900 }}
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
