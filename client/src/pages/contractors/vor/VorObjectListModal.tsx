import { useState } from 'react';
import { App, Button, Modal, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, EyeOutlined, UserAddOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { EstimateVor } from '@estimat/shared';
import { api } from '../../../services/api';
import { DEFAULT_PAGINATION } from '../../../lib/tableConfig';
import { useColumnSearch, uniqueFilters } from '../../../lib/tableColumnSearch';
import { VorPreviewModal } from '../../estimates/components/VorPreviewModal';
import { VorAssignModal } from './VorAssignModal';

interface Props {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  /** Подсветить строку (вход по метке «В» из таблицы сметы); null — просто реестр. */
  focusVorId?: string | null;
  /** Обновить смету после назначения/загрузки цен. */
  onChanged: () => void;
}

// Список значений колонкой тегов: длинные перечисления не должны растягивать строку таблицы.
function TagList({ values }: { values: string[] }) {
  if (values.length === 0) return <span style={{ color: 'var(--est-text-tertiary)' }}>—</span>;
  const shown = values.slice(0, 3);
  return (
    <Space size={4} wrap>
      {shown.map((v) => (
        <Tag key={v} style={{ marginInlineEnd: 0 }}>
          {v}
        </Tag>
      ))}
      {values.length > shown.length && (
        <Tooltip title={values.join(', ')}>
          <Tag style={{ marginInlineEnd: 0 }}>+{values.length - shown.length}</Tag>
        </Tooltip>
      )}
    </Space>
  );
}

/**
 * Реестр ВОР объекта (раздел «Подрядчики»). Здесь ВОР не создают и не удаляют — это операции
 * раздела «Смета»; здесь его смотрят, скачивают и раздают подрядчикам.
 *
 * «Местоположения» и «Типы» — какими они были на момент выгрузки (снимок строк ВОР), а не какими
 * стали в смете: реестр должен совпадать с тем, что подрядчик видит в присланном файле.
 */
export function VorObjectListModal({ open, onClose, estimateId, focusVorId = null, onChanged }: Props) {
  const { message } = App.useApp();
  const { getColumnSearchProps } = useColumnSearch<EstimateVor>();
  const [previewVor, setPreviewVor] = useState<{ id: string; name: string } | null>(null);
  const [assignVor, setAssignVor] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['estimate-vor', estimateId],
    queryFn: () => api.get<{ data: EstimateVor[] }>(`/estimates/${estimateId}/vors`).then((r) => r.data),
    enabled: open,
  });

  const columns: ColumnsType<EstimateVor> = [
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      ...getColumnSearchProps((r) => r.name),
    },
    {
      title: 'Автор',
      dataIndex: 'createdByName',
      key: 'createdByName',
      width: 170,
      ellipsis: true,
      filters: uniqueFilters(data ?? [], (r) => r.createdByName),
      filterSearch: true,
      onFilter: (value, record) => record.createdByName === value,
    },
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (v: string) => new Date(v).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }),
    },
    {
      title: 'Местоположения',
      key: 'locations',
      width: 260,
      render: (_v, r) => <TagList values={r.facets.locations} />,
    },
    {
      title: 'Типы',
      key: 'types',
      width: 220,
      render: (_v, r) => <TagList values={r.facets.types} />,
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 180,
      render: (_v, r) => (
        <Space size={4}>
          <Tooltip title="Просмотр">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              aria-label="Просмотр ВОР"
              onClick={() => setPreviewVor({ id: r.id, name: r.name })}
            />
          </Tooltip>
          <Tooltip title="Скачать">
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              aria-label="Скачать ВОР"
              onClick={() =>
                api
                  .downloadGet(`/estimates/${estimateId}/vors/${r.id}/file?disposition=attachment`, r.fileName)
                  .catch((e: Error) => message.error(e.message))
              }
            />
          </Tooltip>
          <Button
            type="link"
            size="small"
            icon={<UserAddOutlined />}
            onClick={() => setAssignVor({ id: r.id, name: r.name })}
          >
            Назначить
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Modal
        title="ВОР объекта"
        open={open}
        onCancel={onClose}
        footer={null}
        width="90%"
        style={{ maxWidth: 1200 }}
        destroyOnClose
      >
        <Table<EstimateVor>
          rowKey="id"
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={data ?? []}
          pagination={DEFAULT_PAGINATION}
          onRow={(r) => ({
            style: r.id === focusVorId ? { background: 'var(--est-warning-bg)' } : undefined,
          })}
          locale={{ emptyText: 'По этой смете ещё нет ВОР — создайте его в разделе «Смета».' }}
        />
      </Modal>
      <VorPreviewModal
        open={!!previewVor}
        onClose={() => setPreviewVor(null)}
        estimateId={estimateId}
        vor={previewVor}
      />
      <VorAssignModal
        open={!!assignVor}
        onClose={() => setAssignVor(null)}
        estimateId={estimateId}
        vor={assignVor}
        onChanged={onChanged}
      />
    </>
  );
}
