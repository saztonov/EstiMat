import { Table, Tag, Button, Popconfirm, Space, Tooltip, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { StopOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAllAiJobs, cancelAiJob, deleteAiJob, type AiJobAdminItem } from '../../services/aiExtract';

const SOURCE_LABELS: Record<string, string> = {
  rd_document: 'РД-документ',
  upload_md: 'Загрузка .md',
  catalog_query: 'По справочнику',
};

const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'В очереди', color: 'default' },
  running: { label: 'Обработка', color: 'processing' },
  ready: { label: 'Готово', color: 'cyan' },
  applied: { label: 'В смете', color: 'green' },
  failed: { label: 'Ошибка', color: 'red' },
  cancelled: { label: 'Остановлено', color: 'orange' },
};

const isActive = (s: string) => s === 'pending' || s === 'running';

// Вкладка «Задания ИИ»: список заданий извлечения из РД с остановкой и удалением.
export function AiJobsPanel() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['ai-jobs'],
    queryFn: listAllAiJobs,
    // Живое обновление, пока есть выполняющиеся задания.
    refetchInterval: (q) =>
      (q.state.data?.data ?? []).some((j) => isActive(j.status)) ? 3000 : false,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelAiJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-jobs'] });
      message.success('Задание остановлено');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAiJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-jobs'] });
      message.success('Задание удалено');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const columns: ColumnsType<AiJobAdminItem> = [
    {
      title: 'Документ',
      dataIndex: 'source_ref',
      render: (v: string | null, r) => (
        <div>
          <div>{v || '—'}</div>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{SOURCE_LABELS[r.source_kind] ?? r.source_kind}</span>
        </div>
      ),
    },
    { title: 'Проект', dataIndex: 'project_name', width: 200, render: (v: string | null) => v || '—' },
    { title: 'Запустил', dataIndex: 'created_by_name', width: 180, render: (v: string | null) => v || '—' },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 130,
      render: (s: string) => <Tag color={STATUS[s]?.color}>{STATUS[s]?.label ?? s}</Tag>,
    },
    {
      title: 'Добавлено',
      width: 120,
      render: (_: unknown, r) =>
        r.status === 'applied'
          ? `Р: ${r.works_count ?? 0} · М: ${r.materials_count ?? 0}`
          : '—',
    },
    {
      title: 'Создано',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('ru-RU'),
    },
    {
      title: 'Ошибка',
      dataIndex: 'error',
      width: 80,
      render: (e: string | null) =>
        e ? (
          <Tooltip title={e}>
            <span style={{ color: '#cf1322' }}>есть</span>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: 'Действия',
      width: 130,
      render: (_: unknown, r) => (
        <Space>
          {isActive(r.status) ? (
            <Popconfirm title="Остановить задание?" onConfirm={() => cancelMutation.mutate(r.id)}>
              <Button type="text" size="small" danger title="Остановить" icon={<StopOutlined />} />
            </Popconfirm>
          ) : (
            <Popconfirm
              title="Удалить запись задания? Позиции в смете останутся."
              onConfirm={() => deleteMutation.mutate(r.id)}
            >
              <Button type="text" size="small" danger title="Удалить" icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => queryClient.invalidateQueries({ queryKey: ['ai-jobs'] })}
        >
          Обновить
        </Button>
      </div>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={data?.data}
        loading={isLoading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ y: 'flex' }}
      />
    </div>
  );
}
