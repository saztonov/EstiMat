import { useMemo, useState } from 'react';
import { App, Button, Modal, Popconfirm, Segmented, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BarChartOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiTaskItem, AiTaskKind } from '@estimat/shared';
import { cancelAiTask, listAiTasks } from '../../../services/aiTasks';
import { DEFAULT_PAGINATION } from '../../../lib/tableConfig';
import { modalWidth } from '../../../lib/modalWidth';
import { uniqueFilters, useColumnSearch } from '../../../lib/tableColumnSearch';
import {
  TASK_KIND,
  TASK_STATUS,
  fmtDateTime,
  fmtDateTimeFull,
  fmtDuration,
  fmtInt,
  fmtUsers,
  isActive,
  shortModel,
  taskKey,
  totalTokens,
} from './aiTaskDicts';
import { AiTaskDetailModal } from './AiTaskDetailModal';
import { AiTasksStats } from './AiTasksStats';

/** Окна выборки. Группировка ставится сама при каждой правке сметы — без окна список ею зарастает. */
const DAYS_OPTIONS = [
  { label: '7 дней', value: 7 },
  { label: '30 дней', value: 30 },
  { label: '90 дней', value: 90 },
  { label: 'Всё время', value: 3650 },
];

/**
 * Вкладка «Задания ИИ»: задачи всех трёх контуров, журнал общения с моделью и статистика расхода.
 *
 * Удаления нет намеренно: у чата оно отняло бы переписку у сметчика, у группировки — стёрло бы
 * готовый результат и запустило пересчёт на десятки минут. Остаётся остановка активных.
 */
export function AiTasksPanel() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { getColumnSearchProps } = useColumnSearch<AiTaskItem>();
  const [days, setDays] = useState(30);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['ai-tasks', days],
    queryFn: () => listAiTasks(days),
    // Живое обновление, пока есть выполняющиеся: ход чата живёт 10-30 с, при большем интервале
    // «Обработка» просто не попадётся на глаза.
    refetchInterval: (q) =>
      (q.state.data?.data ?? []).some((t) => isActive(t.status)) ? 3000 : false,
  });

  const rows = useMemo(() => data?.data ?? [], [data]);
  // Выбранная строка хранится КЛЮЧОМ: при поллинге модалка видит свежие данные, а если задача
  // исчезла из выборки — закрывается сама.
  const selected = rows.find((r) => taskKey(r) === selectedKey) ?? null;

  const cancelMutation = useMutation({
    mutationFn: (t: AiTaskItem) => cancelAiTask(t.kind, t.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-tasks'] });
      message.success('Задача остановлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const columns: ColumnsType<AiTaskItem> = [
    {
      title: 'Тип',
      dataIndex: 'kind',
      key: 'kind',
      width: 118,
      sorter: (a, b) => TASK_KIND[a.kind].label.localeCompare(TASK_KIND[b.kind].label),
      filters: Object.entries(TASK_KIND).map(([value, { full }]) => ({ text: full, value })),
      onFilter: (value, r) => r.kind === value,
      render: (k: AiTaskKind) => <Tag color={TASK_KIND[k].color}>{TASK_KIND[k].label}</Tag>,
    },
    {
      title: 'Задача',
      key: 'title',
      ellipsis: true,
      sorter: (a, b) => a.title.localeCompare(b.title),
      ...getColumnSearchProps((r) => `${r.title} ${r.subtitle ?? ''}`),
      render: (_v, r) => (
        <Tooltip title={r.subtitle ? `${r.title} · ${r.subtitle}` : r.title}>
          <span>{r.title}</span>
          {r.subtitle && <span style={{ color: '#8c8c8c' }}> · {r.subtitle}</span>}
        </Tooltip>
      ),
    },
    {
      title: 'Проект',
      dataIndex: 'projectName',
      key: 'projectName',
      width: 150,
      ellipsis: true,
      sorter: (a, b) => (a.projectName ?? '').localeCompare(b.projectName ?? ''),
      filters: uniqueFilters(rows, (r) => r.projectName),
      filterSearch: true,
      onFilter: (value, r) => r.projectName === value,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Запустил',
      key: 'users',
      width: 140,
      ellipsis: true,
      sorter: (a, b) => (a.users[0] ?? '').localeCompare(b.users[0] ?? ''),
      // Плоский список авторов: у чат-сессии их может быть несколько (доступ даёт смета).
      filters: uniqueFilters(
        rows.flatMap((r) => (r.users.length ? r.users : r.kind === 'grouping' ? ['Система'] : [])).map((u) => ({ u })),
        (x) => x.u,
      ),
      onFilter: (value, r) =>
        r.users.length ? r.users.includes(String(value)) : r.kind === 'grouping' && value === 'Система',
      render: (_v, r) => (
        <Tooltip title={r.users.length > 1 ? r.users.join(', ') : undefined}>
          {fmtUsers(r.users, r.kind)}
        </Tooltip>
      ),
    },
    {
      title: 'Модель',
      key: 'models',
      width: 130,
      ellipsis: true,
      filters: uniqueFilters(rows.flatMap((r) => r.models).map((m) => ({ m })), (x) => x.m),
      filterSearch: true,
      onFilter: (value, r) => r.models.includes(String(value)),
      render: (_v, r) =>
        r.models.length ? (
          <Tooltip title={r.models.join(', ')}>
            {shortModel(r.models[0]!)}
            {r.models.length > 1 && ` +${r.models.length - 1}`}
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 112,
      sorter: (a, b) =>
        (TASK_STATUS[a.status]?.label ?? a.status).localeCompare(TASK_STATUS[b.status]?.label ?? b.status),
      filters: Object.entries(TASK_STATUS).map(([value, { label }]) => ({ text: label, value })),
      onFilter: (value, r) => r.status === value,
      render: (s: string, r) => (
        <Tooltip title={`Исходный статус: ${r.rawStatus}`}>
          <Tag color={TASK_STATUS[s]?.color}>{TASK_STATUS[s]?.label ?? s}</Tag>
        </Tooltip>
      ),
    },
    {
      title: 'Токены',
      key: 'tokens',
      width: 92,
      align: 'right',
      sorter: (a, b) => (totalTokens(a) ?? -1) - (totalTokens(b) ?? -1),
      render: (_v, r) => {
        const t = totalTokens(r);
        // Прочерк, а не «0»: расход неизвестен, если журнала ещё не было или ответ пришёл без usage.
        if (t == null) {
          return (
            <Tooltip title={r.hasFallback ? 'Ответ без вызова модели' : 'Расход не сохранялся'}>
              <span style={{ color: '#bfbfbf' }}>—</span>
            </Tooltip>
          );
        }
        return (
          <Tooltip title={`Вход: ${fmtInt(r.promptTokens)} · Выход: ${fmtInt(r.completionTokens)}`}>
            <span>{fmtInt(t)}</span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Выз',
      key: 'calls',
      width: 64,
      align: 'right',
      sorter: (a, b) => a.callsTotal - b.callsTotal,
      render: (_v, r) =>
        r.callsTotal ? (
          <Tooltip
            title={
              r.httpAttempts > r.callsTotal
                ? `HTTP-попыток: ${r.httpAttempts} — шлюз отвечал отказом`
                : `Успешных вызовов: ${r.callsOk} из ${r.callsTotal}`
            }
          >
            <span style={{ color: r.callsOk < r.callsTotal ? '#cf1322' : undefined }}>
              {r.callsOk}/{r.callsTotal}
            </span>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: 'Время',
      key: 'duration',
      width: 72,
      align: 'right',
      sorter: (a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0),
      render: (_v, r) => fmtDuration(r.durationMs),
    },
    {
      title: 'Итог',
      dataIndex: 'resultSummary',
      key: 'resultSummary',
      width: 104,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Ошиб',
      dataIndex: 'error',
      key: 'error',
      width: 84,
      // sorter убран намеренно: он дублировал фильтр «Есть/Нет», а его иконка съедала ширину
      // заголовка — из-за неё «Ошибка» и резалась на слоги.
      filters: [
        { text: 'Есть', value: 'yes' },
        { text: 'Нет', value: 'no' },
      ],
      onFilter: (value, r) => (value === 'yes' ? !!r.error : !r.error),
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
      title: 'Создано',
      dataIndex: 'activityAt',
      key: 'activityAt',
      width: 116,
      sorter: (a, b) => a.activityAt.localeCompare(b.activityAt),
      defaultSortOrder: 'descend',
      render: (v: string, r) => (
        <Tooltip title={`Создано: ${fmtDateTimeFull(r.createdAt)}`}>{fmtDateTime(v)}</Tooltip>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 44,
      render: (_v, r) =>
        isActive(r.status) ? (
          // stopPropagation: иначе клик по кнопке и по «Да» в подтверждении откроет карточку —
          // события из портала всплывают по дереву React, а не DOM.
          <div onClick={(e) => e.stopPropagation()}>
            <Popconfirm title="Остановить задачу?" onConfirm={() => cancelMutation.mutate(r)}>
              <Button type="text" size="small" danger title="Остановить" icon={<StopOutlined />} />
            </Popconfirm>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="table-page-wrapper" style={{ paddingTop: 8 }}>
      <div style={{ marginBottom: 8, display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
        <Segmented
          size="small"
          options={DAYS_OPTIONS}
          value={days}
          onChange={(v) => setDays(v as number)}
        />
        <Space size={8}>
          <Button size="small" icon={<BarChartOutlined />} onClick={() => setStatsOpen(true)}>
            Статистика
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => queryClient.invalidateQueries({ queryKey: ['ai-tasks'] })}
          >
            Обновить
          </Button>
        </Space>
      </div>
      <Table
        className="estimat-compact estimat-th-nowrap"
        rowKey={taskKey}
        size="small"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        pagination={DEFAULT_PAGINATION}
        scroll={{ x: 1300, y: 'flex' }}
        rowClassName={() => 'estimat-row-clickable'}
        onRow={(r) => ({ onClick: () => setSelectedKey(taskKey(r)) })}
      />
      <AiTaskDetailModal task={selected} onClose={() => setSelectedKey(null)} />
      <Modal
        title="Статистика ИИ"
        open={statsOpen}
        onCancel={() => setStatsOpen(false)}
        footer={null}
        width={modalWidth(900)}
        style={{ top: 40 }}
        styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflow: 'auto' } }}
      >
        <AiTasksStats enabled={statsOpen} />
      </Modal>
    </div>
  );
}
