import { useEffect, useState } from 'react';
import { Modal, Table, Button, Space, Popover, Tag, Tooltip, Badge, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DownloadOutlined,
  EyeOutlined,
  DeleteOutlined,
  LoginOutlined,
  FileExcelOutlined,
  DiffOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { DEFAULT_PAGINATION } from '../../../lib/tableConfig';
import { ConfirmIconButton } from '../../../components/shared/ConfirmIconButton';
import { useColumnSearch, uniqueFilters } from '../../../lib/tableColumnSearch';
import type { EstimateVor, VorFilterSnapshot } from '@estimat/shared';
import { VorPreviewModal } from './VorPreviewModal';
import { VorDiffDrawer } from './VorDiffDrawer';

// Ячейка «Актуальность» ВОР: изменено/удалено N, актуально, снимок недоступен (для легаси-ВОР).
function VorStatusCell({ r }: { r: EstimateVor }) {
  if (!r.diffAvailable) return <Badge status="default" text="Снимок недоступен" />;
  const parts: string[] = [];
  if (r.counts.changed) parts.push(`изменено ${r.counts.changed}`);
  if (r.counts.deleted) parts.push(`удалено ${r.counts.deleted}`);
  if (parts.length === 0) return <Badge status="success" text="Актуально" />;
  return <Badge status="warning" text={parts.join(', ')} />;
}

interface Props {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  // Подсветить/прокрутить к этому ВОР (клик по метке «В» в строке); null — просто список.
  focusVorId: string | null;
  // «Перейти»: применить сохранённый снимок фильтров к смете и закрыть модалку.
  // Не нужен в режиме readOnly — там кнопки нет.
  onApplyFilters?: (snapshot: VorFilterSnapshot) => void;
  // «Экспорт в Excel»: открыть модалку экспорта (список остаётся открытым под ней).
  onExport?: () => void;
  /** Только просмотр (раздел «Подрядчики»): без экспорта, перехода к фильтрам сметы и удаления.
   *  Эти действия принадлежат разделу «Смета» — здесь список открывают, чтобы посмотреть ВОР
   *  строки и при необходимости скачать файл. */
  readOnly?: boolean;
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
        <span style={{ minWidth: 88, color: 'var(--est-text-tertiary)', fontSize: 12 }}>{label}</span>
        <span style={{ flex: 1 }}>{value}</span>
      </div>
    ) : null;
  const loc = [f.zones.map((z) => z.name).join(', '), f.floorsText.trim() ? `эт. ${f.floorsText.trim()}` : '']
    .filter(Boolean)
    .join(' · ');
  const empty =
    !f.categories.length && !f.types.length && !loc && !f.locationTypes.length &&
    f.volumeType === 'all' && !f.onlyUnreconciled;
  if (empty) return <span style={{ color: 'var(--est-text-tertiary)' }}>Без фильтров (вся смета)</span>;
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

// Ячейки с длинным текстом (название, автор, сводка фильтров) переносим по словам вместо
// многоточия: сметчику нужно видеть значение целиком, а не гадать по обрезку. Ширины окна для
// этого мало — длинные шифры РД и ФИО не влезают в строку на любом разумном размере модалки.
const wrapCell = () => ({ style: { whiteSpace: 'normal' as const, wordBreak: 'break-word' as const } });

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
export function VorListModal({
  open,
  onClose,
  estimateId,
  focusVorId,
  onApplyFilters,
  onExport,
  readOnly = false,
}: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { getColumnSearchProps } = useColumnSearch<EstimateVor>();
  // Предпросмотр файла ВОР поверх списка (null — закрыт).
  const [previewVor, setPreviewVor] = useState<{ id: string; name: string } | null>(null);
  // Drawer «Отличия от ВОР» (null — закрыт).
  const [diffVor, setDiffVor] = useState<{ id: string; name: string } | null>(null);

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
    { title: 'Название', dataIndex: 'name', key: 'name', onCell: wrapCell, ...getColumnSearchProps((r) => r.name) },
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (v: string) => new Date(v).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }),
    },
    {
      title: 'Актуальность',
      key: 'status',
      width: 150,
      render: (_v, r) => <VorStatusCell r={r} />,
    },
    {
      title: 'Автор',
      dataIndex: 'createdByName',
      key: 'createdByName',
      width: 220,
      onCell: wrapCell,
      filters: uniqueFilters(data ?? [], (r) => r.createdByName),
      filterSearch: true,
      onFilter: (value, record) => record.createdByName === value,
    },
    {
      title: 'Фильтры',
      key: 'filters',
      onCell: wrapCell,
      render: (_v, r) => (
        <Popover content={<FiltersDetail f={r.filters} />} title="Применённые фильтры">
          <span style={{ cursor: 'help', color: 'var(--est-text-secondary)' }}>{filtersShort(r.filters)}</span>
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
              aria-label="Открыть ВОР"
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
        </Space>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      render: (_v, r) => (
        <Space size={4}>
          <Tooltip title={r.diffAvailable ? 'Сравнить с текущей сметой' : 'Снимок недоступен (старый ВОР)'}>
            <Button
              type="text"
              size="small"
              icon={<DiffOutlined />}
              disabled={!r.diffAvailable}
              onClick={() => setDiffVor({ id: r.id, name: r.name })}
            />
          </Tooltip>
          {onApplyFilters && (
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
          )}
          {!readOnly && r.canDelete && (
            <ConfirmIconButton
              tooltip="Удалить"
              title="Удалить ВОР?"
              description="Файл-снимок будет удалён безвозвратно."
              onConfirm={() => deleteMutation.mutate(r.id)}
              icon={<DeleteOutlined />}
              type="text"
              danger
            />
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      {/* 80% ширины экрана: при maxWidth 1100 окно на широком мониторе оставалось узким, и на две
          резиновые колонки (название + фильтры) приходилось ~340px на двоих. Потолок 1800 держит
          строки читаемыми на сверхшироких мониторах. */}
      <Modal title="ВОР" open={open} onCancel={onClose} footer={null} width="80%" style={{ maxWidth: 1800 }} destroyOnClose>
        {onExport && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button type="primary" icon={<FileExcelOutlined />} onClick={onExport}>
              Экспорт в Excel
            </Button>
          </div>
        )}
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
          locale={{
            emptyText: readOnly
              ? 'По этой смете ещё нет ВОР.'
              : 'Пока нет ВОР. Создайте первый через «Экспорт в Excel».',
          }}
        />
      </Modal>
      <VorPreviewModal
        open={!!previewVor}
        onClose={() => setPreviewVor(null)}
        estimateId={estimateId}
        vor={previewVor}
      />
      <VorDiffDrawer
        open={!!diffVor}
        onClose={() => setDiffVor(null)}
        estimateId={estimateId}
        vor={diffVor}
      />
    </>
  );
}
