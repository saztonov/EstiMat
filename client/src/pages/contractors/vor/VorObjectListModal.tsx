import { useState } from 'react';
import { App, Button, Modal, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CloseOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilterOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EstimateVor, VorContractor, VorUnassignResult } from '@estimat/shared';
import { api, apiFetch } from '../../../services/api';
import { DEFAULT_PAGINATION } from '../../../lib/tableConfig';
import { useColumnSearch, uniqueFilters } from '../../../lib/tableColumnSearch';
import { VorPreviewModal } from '../../estimates/components/VorPreviewModal';
import { VorAssignModal } from './VorAssignModal';
import { showBlockedReport } from './blockedReport';

/** Отбор «строки одного договора» — что показать во вкладке «Смета» по кнопке перехода. */
export interface ContractFilter {
  vorId: string;
  vorName: string;
  contractorId: string;
  contractorName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  /** Подсветить строку (вход по метке «В» из таблицы сметы); null — просто реестр. */
  focusVorId?: string | null;
  /** Обновить смету после назначения/снятия/загрузки цен. */
  onChanged: () => void;
  /** Показать в смете только строки этого договора (реестр при этом закрывается). */
  onShowContract: (filter: ContractFilter) => void;
}

// Высота строки подрядчика: столбцы «Подрядчики» и «Договор» читаются парой, поэтому их строки
// обязаны стоять на одной высоте.
const ROW_H = 40;

function formatContractDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Список значений колонкой тегов: длинные перечисления не должны растягивать строку таблицы.
function TagList({ values }: { values: string[] }) {
  if (values.length === 0) return <span style={{ color: 'var(--est-text-tertiary)' }}>—</span>;
  const shown = values.slice(0, 3);
  return (
    <Space size={4} wrap>
      {shown.map((v) => (
        <Tooltip key={v} title={v}>
          <Tag style={{ marginInlineEnd: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {v}
          </Tag>
        </Tooltip>
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
 * раздела «Смета»; здесь его смотрят, скачивают и раздают подрядчикам. Отсюда же подрядчика
 * снимают и переходят к строкам его договора: другого места назначения исполнителей нет.
 *
 * «Местоположения» и «Типы» — какими они были на момент выгрузки (снимок строк ВОР), а не какими
 * стали в смете: реестр должен совпадать с тем, что подрядчик видит в присланном файле.
 */
export function VorObjectListModal({
  open,
  onClose,
  estimateId,
  focusVorId = null,
  onChanged,
  onShowContract,
}: Props) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { getColumnSearchProps } = useColumnSearch<EstimateVor>();
  const [previewVor, setPreviewVor] = useState<{ id: string; name: string } | null>(null);
  const [assignVor, setAssignVor] = useState<
    { id: string; name: string; contractors: VorContractor[] } | null
  >(null);

  const { data, isLoading } = useQuery({
    queryKey: ['estimate-vor', estimateId],
    queryFn: () => api.get<{ data: EstimateVor[] }>(`/estimates/${estimateId}/vors`).then((r) => r.data),
    enabled: open,
  });

  // Снятие подрядчика со всех строк этого ВОР. Строки с его собственными заявками на материалы
  // остаются за ним — сервер возвращает их списком.
  const unassign = useMutation({
    mutationFn: (v: { vorId: string; contractorId: string }) =>
      apiFetch<{ data: VorUnassignResult }>(
        `/estimates/${estimateId}/vors/${v.vorId}/contractors/${v.contractorId}`,
        { method: 'DELETE' },
      ).then((r) => r.data),
    onSuccess: (res, v) => {
      const parts = [`снято строк: ${res.cleared}`];
      if (res.blocked.length > 0) parts.push(`оставлено по заявкам: ${res.blocked.length}`);
      if (res.clearedPrices > 0) parts.push(`снято договорных цен: ${res.clearedPrices}`);
      if (res.blocked.length > 0) message.warning(parts.join(' · '));
      else message.success(parts.join(' · '));
      showBlockedReport(modal, res.blocked, new Map(), 'unassign');
      queryClient.invalidateQueries({ queryKey: ['estimate-vor', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['vor-scope', estimateId, v.vorId] });
      onChanged();
    },
    onError: (e: Error) => message.error(e.message),
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
      width: 240,
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
      width: 300,
      render: (_v, r) => <TagList values={r.facets.types} />,
    },
    {
      title: 'Подрядчики',
      key: 'contractors',
      width: 300,
      render: (_v, r) =>
        r.contractors.length === 0 ? (
          <span style={{ color: 'var(--est-text-tertiary)' }}>—</span>
        ) : (
          <div>
            {r.contractors.map((c) => {
              // Строк за подрядчиком не осталось (сняли или удалили из сметы), а договор есть:
              // показываем отдельным состоянием, переходить некуда.
              const empty = c.itemsCount === 0;
              return (
                <div
                  key={c.contractorId}
                  style={{ height: ROW_H, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: empty ? 'var(--est-text-tertiary)' : undefined,
                    }}
                    title={c.contractorName ?? '—'}
                  >
                    {c.contractorName ?? '—'}
                  </span>
                  {empty && <Tag style={{ marginInlineEnd: 0 }}>без строк</Tag>}
                  <Tooltip title={empty ? 'Строк за подрядчиком нет' : 'Показать строки договора в смете'}>
                    <Button
                      type="text"
                      size="small"
                      icon={<FilterOutlined />}
                      disabled={empty}
                      aria-label="Показать строки договора"
                      onClick={() =>
                        onShowContract({
                          vorId: r.id,
                          vorName: r.name,
                          contractorId: c.contractorId,
                          contractorName: c.contractorName ?? '—',
                        })
                      }
                    />
                  </Tooltip>
                  <Popconfirm
                    title="Снять подрядчика?"
                    description="Он уйдёт со всех строк этого ВОР. Строки с оформленными заявками останутся за ним."
                    okText="Снять"
                    okButtonProps={{ danger: true }}
                    cancelText="Отмена"
                    onConfirm={() => unassign.mutate({ vorId: r.id, contractorId: c.contractorId })}
                  >
                    <Tooltip title="Снять подрядчика">
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<CloseOutlined />}
                        aria-label="Снять подрядчика"
                      />
                    </Tooltip>
                  </Popconfirm>
                </div>
              );
            })}
          </div>
        ),
    },
    {
      title: 'Договор',
      key: 'contract',
      width: 150,
      render: (_v, r) =>
        r.contractors.length === 0 ? (
          <span style={{ color: 'var(--est-text-tertiary)' }}>—</span>
        ) : (
          <div>
            {r.contractors.map((c) => (
              <div
                key={c.contractorId}
                style={{ height: ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
              >
                <span>{c.contractNumber || <span style={{ color: 'var(--est-text-tertiary)' }}>—</span>}</span>
                {c.contractDate && (
                  <span style={{ fontSize: 11, color: 'var(--est-text-tertiary)' }}>
                    {formatContractDate(c.contractDate)}
                  </span>
                )}
              </div>
            ))}
          </div>
        ),
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
            onClick={() => setAssignVor({ id: r.id, name: r.name, contractors: r.contractors })}
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
        width="85%"
        destroyOnClose
      >
        <Table<EstimateVor>
          rowKey="id"
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={data ?? []}
          scroll={{ x: 1700 }}
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
