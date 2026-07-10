import { useEffect } from 'react';
import { Modal, Table, Button, Space, Popconfirm, Popover, Tag, Tooltip, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, EyeOutlined, DeleteOutlined, LoginOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { DEFAULT_PAGINATION } from '../../../lib/tableConfig';
import type { EstimateVor, VorFilterSnapshot } from '@estimat/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  // Подсветить/прокрутить к этому ВОР (клик по метке «В» в строке); null — просто список.
  focusVorId: string | null;
  // «Перейти»: применить сохранённый снимок фильтров к смете и закрыть модалку.
  onApplyFilters: (snapshot: VorFilterSnapshot) => void;
}

const VOLUME_LABEL: Record<VorFilterSnapshot['volumeType'], string> = {
  all: '',
  main: 'осн',
  additional: 'доп',
};

// Полная сводка фильтров (для Popover). Удалённые значения справочника уже помечены сервером «(удалено)».
function FiltersDetail({ f }: { f: VorFilterSnapshot }) {
  const row = (label: string, value: string) =>
    value ? (
      <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
        <span style={{ minWidth: 88, color: '#8c8c8c', fontSize: 12 }}>{label}</span>
        <span style={{ flex: 1 }}>{value}</span>
      </div>
    ) : null;
  const loc = [f.zones.map((z) => z.name).join(', '), f.floorsText.trim() ? `эт. ${f.floorsText.trim()}` : '']
    .filter(Boolean)
    .join(' · ');
  const empty =
    !f.categories.length && !f.types.length && !loc && !f.locationTypes.length &&
    f.volumeType === 'all' && !f.onlyUnreconciled;
  if (empty) return <span style={{ color: '#8c8c8c' }}>Без фильтров (вся смета)</span>;
  return (
    <div style={{ maxWidth: 320 }}>
      {row('Категория', f.categories.map((c) => c.name).join(', '))}
      {row('Вид работ', f.types.map((t) => t.name).join(', '))}
      {row('Локация', loc)}
      {row('Тип', f.locationTypes.map((l) => l.name).join(', '))}
      {row('Объём', VOLUME_LABEL[f.volumeType])}
      {f.onlyUnreconciled ? row('Отбор', 'Только несогласованные') : null}
    </div>
  );
}

// Короткая сводка фильтров для ячейки таблицы.
function filtersShort(f: VorFilterSnapshot): string {
  const parts: string[] = [];
  if (f.categories.length) parts.push(f.categories.map((c) => c.name).join(', '));
  if (f.types.length) parts.push(f.types.map((t) => t.name).join(', '));
  if (f.zones.length) parts.push(f.zones.map((z) => z.name).join(', '));
  if (f.floorsText.trim()) parts.push(`эт. ${f.floorsText.trim()}`);
  if (f.locationTypes.length) parts.push(f.locationTypes.map((l) => l.name).join(', '));
  if (f.volumeType !== 'all') parts.push(VOLUME_LABEL[f.volumeType]);
  if (f.onlyUnreconciled) parts.push('несогл.');
  return parts.join(' · ') || 'Без фильтров';
}

// Модалка «Созданные ВОР»: история выгрузок сметы. Открыть/скачать файл-снимок, перейти
// (применить сохранённые фильтры к смете), удалить.
export function VorListModal({ open, onClose, estimateId, focusVorId, onApplyFilters }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['estimate-vor', estimateId],
    queryFn: () => api.get<{ data: EstimateVor[] }>(`/estimates/${estimateId}/vors`).then((r) => r.data),
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: (vorId: string) => api.delete(`/estimates/${estimateId}/vors/${vorId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate-vor', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimate-vor-marks', estimateId] });
      message.success('ВОР удалён');
    },
    onError: (err: Error) => message.error(err.message),
  });

  // Прокрутить к подсвеченной строке при открытии/смене фокуса.
  useEffect(() => {
    if (!open || !focusVorId || !data) return;
    const t = setTimeout(() => {
      document.querySelector(`[data-row-key="${focusVorId}"]`)?.scrollIntoView({ block: 'center' });
    }, 100);
    return () => clearTimeout(t);
  }, [open, focusVorId, data]);

  const columns: ColumnsType<EstimateVor> = [
    { title: 'Название', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (v: string) => new Date(v).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }),
    },
    { title: 'Автор', dataIndex: 'createdByName', key: 'createdByName', width: 160, ellipsis: true },
    {
      title: 'Фильтры',
      key: 'filters',
      ellipsis: true,
      render: (_v, r) => (
        <Popover content={<FiltersDetail f={r.filters} />} title="Применённые фильтры">
          <span style={{ cursor: 'help', color: '#595959' }}>{filtersShort(r.filters)}</span>
        </Popover>
      ),
    },
    {
      title: 'Файл',
      key: 'file',
      width: 110,
      render: (_v, r) => (
        <Space size={4}>
          <Tooltip title="Открыть">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() =>
                api.openGet(`/estimates/${estimateId}/vors/${r.id}/file?disposition=inline`).catch((e: Error) =>
                  message.error(e.message),
                )
              }
            />
          </Tooltip>
          <Tooltip title="Скачать">
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() =>
                api
                  .downloadGet(`/estimates/${estimateId}/vors/${r.id}/file?disposition=attachment`, r.fileName)
                  .catch((e: Error) => message.error(e.message))
              }
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      render: (_v, r) => (
        <Space size={4}>
          <Tooltip title="Применить фильтры этого ВОР к смете">
            <Button
              type="text"
              size="small"
              icon={<LoginOutlined />}
              onClick={() => {
                onApplyFilters(r.filters);
                onClose();
              }}
            >
              Перейти
            </Button>
          </Tooltip>
          {r.canDelete && (
            <Popconfirm
              title="Удалить ВОР?"
              description="Файл-снимок будет удалён безвозвратно."
              okText="Удалить"
              cancelText="Отмена"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteMutation.mutate(r.id)}
            >
              <Tooltip title="Удалить">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Modal title="Созданные ВОР" open={open} onCancel={onClose} footer={null} width="90%" style={{ maxWidth: 1100 }}>
      <Table<EstimateVor>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={data ?? []}
        pagination={DEFAULT_PAGINATION}
        onRow={(r) => ({
          style: r.id === focusVorId ? { background: '#fff7e6' } : undefined,
        })}
        locale={{ emptyText: 'Пока нет созданных ВОР. Выгрузите смету через «Экспорт в Excel».' }}
      />
    </Modal>
  );
}
