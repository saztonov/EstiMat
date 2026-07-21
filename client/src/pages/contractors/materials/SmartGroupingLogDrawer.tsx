import { useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Space, Spin, Table, Tag, Typography } from 'antd';
import { CheckCircleTwoTone, CloseCircleTwoTone, CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { GroupingCallSummary } from '@estimat/shared';
import { DEFAULT_PAGINATION } from '../../../lib/tableConfig';
import { useGroupingCall, useGroupingCalls } from './useSmartGrouping';
import { CALL_STATUS_LABEL, PARSE_STATUS_LABEL, formatCountdown, formatElapsed } from './smartGroupingText';

interface Props {
  jobId: string | null;
  /** Задание живо — журнал поллим и показываем незавершённые вызовы. */
  active: boolean;
  open: boolean;
  onClose: () => void;
}

const RUNNING = new Set(['queued', 'waiting_slot', 'in_progress']);
const BAD = new Set(['failed', 'timed_out', 'empty']);

/**
 * Журнал обмена с моделью: что ушло, что вернулось, сколько это заняло.
 *
 * Только для администратора (сервер тоже это проверяет): здесь сырые промпты и названия
 * материалов всей сметы.
 */
export function SmartGroupingLogDrawer({ jobId, active, open, onClose }: Props) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const calls = useGroupingCalls(jobId, open, active);
  const job = calls.data?.job;
  const rows = calls.data?.data ?? [];
  const now = Date.now();

  const columns: ColumnsType<GroupingCallSummary> = [
    {
      title: 'Вызов',
      key: 'what',
      width: 150,
      render: (_v, r) => (
        <Space size={6}>
          {RUNNING.has(r.status) ? (
            <Spin size="small" />
          ) : r.status === 'succeeded' ? (
            <CheckCircleTwoTone twoToneColor="#52c41a" />
          ) : (
            <CloseCircleTwoTone twoToneColor="#cf1322" />
          )}
          <span>{r.kind === 'merge' ? 'Слияние' : `Набор ${(r.batchIndex ?? 0) + 1}`}</span>
        </Space>
      ),
    },
    {
      title: 'Состояние',
      key: 'status',
      width: 190,
      render: (_v, r) => (
        <Space size={4} wrap>
          <span style={{ color: BAD.has(r.status) ? '#cf1322' : undefined }}>
            {CALL_STATUS_LABEL[r.status] ?? r.status}
          </span>
          {r.httpStatus != null && r.httpStatus >= 400 && <Tag color="red">HTTP {r.httpStatus}</Tag>}
          {/* Больше одной попытки — это уже история: шлюз отвечал отказом. */}
          {r.httpAttempts > 1 && <Tag>попыток: {r.httpAttempts}</Tag>}
        </Space>
      ),
    },
    {
      title: 'Время',
      key: 'time',
      width: 100,
      render: (_v, r) =>
        r.durationMs != null
          ? formatElapsed(r.durationMs)
          : RUNNING.has(r.status)
            ? formatElapsed(now - new Date(r.startedAt).getTime())
            : '—',
    },
    {
      title: 'Токены',
      dataIndex: 'totalTokens',
      width: 90,
      render: (v: number | null) => (v == null ? '—' : v.toLocaleString('ru-RU')),
    },
    {
      title: 'Разбор',
      key: 'parse',
      width: 190,
      render: (_v, r) => (
        <span style={{ color: r.parseStatus === 'failed' ? '#cf1322' : undefined }}>
          {PARSE_STATUS_LABEL[r.parseStatus] ?? r.parseStatus}
          {r.groupsCount != null && r.parseStatus !== 'not_run' && ` · групп: ${r.groupsCount}`}
        </span>
      ),
    },
    {
      title: 'Ошибка',
      dataIndex: 'error',
      ellipsis: true,
      render: (v: string | null) => v ?? '',
    },
  ];

  const countdown = job ? formatCountdown(job.nextRunAt, now) : null;

  return (
    <Drawer
      title="Журнал ИИ — умная группировка"
      placement="right"
      width={900}
      open={open}
      onClose={onClose}
      styles={{ body: { paddingTop: 12 } }}
    >
      {calls.isLoading && <Spin style={{ margin: 24 }} />}
      {calls.isError && <Alert type="error" showIcon message="Не удалось загрузить журнал" />}

      {job && (
        <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
          <Descriptions.Item label="Модель">{job.model ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Состояние">{job.status}</Descriptions.Item>
          <Descriptions.Item label="Обработано">
            {job.batchesDone} из {job.batchesTotal}
          </Descriptions.Item>
          <Descriptions.Item label="Попытка">
            {job.attempts} из {job.maxAttempts}
            {countdown && ` · повтор ${countdown}`}
          </Descriptions.Item>
          {job.error && (
            <Descriptions.Item label="Последняя ошибка" span={2}>
              <span style={{ color: '#cf1322' }}>{job.error}</span>
            </Descriptions.Item>
          )}
        </Descriptions>
      )}

      <Table<GroupingCallSummary>
        rowKey="id"
        size="small"
        className="estimat-compact"
        dataSource={rows}
        columns={columns}
        pagination={DEFAULT_PAGINATION}
        scroll={{ x: 900 }}
        locale={{
          emptyText: <Empty description={active ? 'Запросов пока нет — расчёт готовится' : 'Обращений к модели не было'} />,
        }}
        expandable={{
          expandedRowKeys: expanded,
          onExpandedRowsChange: (keys) => setExpanded(keys as string[]),
          // Тексты грузим лениво: промпт набора — тысячи символов, а строк в журнале десятки.
          expandedRowRender: (r) => <CallDetail jobId={jobId} callId={r.id} />,
        }}
      />
    </Drawer>
  );
}

/** Полный обмен по одному вызову. */
function CallDetail({ jobId, callId }: { jobId: string | null; callId: string }) {
  const q = useGroupingCall(jobId, callId);
  const d = q.data?.data;

  if (q.isLoading) return <Spin size="small" />;
  if (q.isError || !d) return <Alert type="error" showIcon message="Не удалось загрузить вызов" />;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={10}>
      {d.parseWarnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Замечания при разборе ответа"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {d.parseWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      {d.attemptsLog.length > 0 && (
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            HTTP-попытки
          </Typography.Text>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
            {d.attemptsLog.map((a) => (
              <li key={a.no}>
                #{a.no} · {a.status ?? 'нет ответа'} · {formatElapsed(a.durationMs)}
                {/* Очередь к шлюзу — не время модели: иначе «долго» читается как «модель тупит». */}
                {!!a.waitedMs && a.waitedMs >= 1000 && ` · ждал очереди ${formatElapsed(a.waitedMs)}`}
                {a.retryDelayMs != null && ` · повтор через ${formatElapsed(a.retryDelayMs)}`}
                {/* Идентификатор нужен, чтобы найти этот же запрос в журнале шлюза. */}
                <span style={{ color: '#8c8c8c' }}> · {a.requestId}</span>
                {a.errorBody && <div style={{ color: '#cf1322', whiteSpace: 'pre-wrap' }}>{a.errorBody}</div>}
                {a.networkError && <div style={{ color: '#cf1322' }}>{a.networkError}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <TextBlock title="Системный промпт" text={d.systemText} />
      <TextBlock title="Запрос" text={d.requestText} />
      <TextBlock
        title={`Ответ модели${d.finishReason ? ` (finish_reason: ${d.finishReason})` : ''}`}
        text={d.responseText}
      />
    </Space>
  );
}

function TextBlock({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <Space size={8} style={{ marginBottom: 4 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {title}
        </Typography.Text>
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          onClick={() => void navigator.clipboard.writeText(text)}
        >
          Копировать
        </Button>
      </Space>
      <pre
        style={{
          margin: 0,
          maxHeight: 260,
          overflow: 'auto',
          background: 'rgba(0,0,0,0.03)',
          padding: 8,
          borderRadius: 4,
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </pre>
    </div>
  );
}
