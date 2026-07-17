import { Alert, Collapse, Empty, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import type { AiTaskHttpAttempt } from '@estimat/shared';
import { getAiTaskCall } from '../../../services/aiTasks';
import { PARSE_STATUS, fmtDuration, parseMessages } from './aiTaskDicts';
import { LlmMessageView } from './LlmMessageView';

/** Попытки: у каждой свой X-Request-Id — по нему вызов сверяется с журналом шлюза. */
const attemptColumns: ColumnsType<AiTaskHttpAttempt> = [
  { title: '#', dataIndex: 'no', width: 40 },
  {
    title: 'Код',
    dataIndex: 'status',
    width: 70,
    render: (v: number | null, r) =>
      v == null ? (
        <Tag color="red">нет ответа</Tag>
      ) : v >= 400 ? (
        <Tag color="red">{v}</Tag>
      ) : (
        <span>{v}</span>
      ),
  },
  { title: 'Ожидание', dataIndex: 'waitedMs', width: 90, render: (v: number) => fmtDuration(v) },
  { title: 'Запрос', dataIndex: 'durationMs', width: 90, render: (v: number) => fmtDuration(v) },
  {
    title: 'Пауза',
    dataIndex: 'retryDelayMs',
    width: 80,
    render: (v: number | null) => (v == null ? '—' : fmtDuration(v)),
  },
  { title: 'X-Request-Id', dataIndex: 'requestId', ellipsis: true },
  {
    title: 'Отказ',
    key: 'err',
    ellipsis: true,
    render: (_v, r) => r.errorBody || r.networkError || '—',
  },
];

/**
 * Тело одного вызова: что ушло, что вернулось и сколько попыток понадобилось.
 *
 * Тексты грузятся только при раскрытии панели: у задания РД вызовов сотни, и тянуть их промпты
 * вместе со списком — мегабайты в модалку.
 */
export function AiLogCall({ callId, open }: { callId: string; open: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-task-call', callId],
    queryFn: () => getAiTaskCall(callId),
    enabled: open,
    gcTime: 0,
    staleTime: 60_000,
  });

  if (isLoading) return <Spin size="small" />;
  if (error) return <Alert type="error" showIcon message={(error as Error).message} />;
  const c = data?.data;
  if (!c) return <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  if (c.textsPurged) {
    return (
      <Alert
        type="info"
        showIcon
        message="Тексты запроса и ответа вычищены"
        description="Промпты и ответы хранятся 7 дней — расход токенов и статусы по этому вызову сохранены."
      />
    );
  }

  const messages = parseMessages(c.requestText);

  return (
    <div>
      {c.error && <Alert type="error" showIcon message={c.error} style={{ marginBottom: 8 }} />}
      {c.parseWarnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={`Разбор ответа: ${PARSE_STATUS[c.parseStatus] ?? c.parseStatus}`}
          description={<ul style={{ margin: 0, paddingLeft: 18 }}>{c.parseWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        />
      )}

      {/* Системный промпт свёрнут: он одинаков во всех вызовах этапа и занимает половину объёма. */}
      {c.systemText && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'sys',
              label: `Системный промпт (${c.systemText.length.toLocaleString('ru-RU')} симв.)`,
              children: <pre className="ai-log-pre">{c.systemText}</pre>,
            },
          ]}
        />
      )}

      <Typography.Text strong style={{ fontSize: 12 }}>
        Запрос
      </Typography.Text>
      {messages ? (
        messages.map((m, i) => <LlmMessageView key={i} m={m} />)
      ) : (
        <pre className="ai-log-pre">{c.requestText || '—'}</pre>
      )}

      <Typography.Text strong style={{ fontSize: 12 }}>
        Ответ
      </Typography.Text>
      {c.finishReason && (
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {' '}
          (finish_reason: {c.finishReason})
        </Typography.Text>
      )}
      <pre className="ai-log-pre">{c.responseText || '—'}</pre>

      {c.attempts.length > 1 && (
        <>
          <Typography.Text strong style={{ fontSize: 12 }}>
            HTTP-попытки
          </Typography.Text>
          <Table
            className="estimat-compact"
            size="small"
            rowKey="no"
            columns={attemptColumns}
            dataSource={c.attempts}
            pagination={false}
          />
        </>
      )}
    </div>
  );
}
