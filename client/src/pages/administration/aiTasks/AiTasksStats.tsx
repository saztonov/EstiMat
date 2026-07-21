import { useState } from 'react';
import { Alert, Col, Divider, Empty, Row, Segmented, Spin, Statistic, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import type { AiTaskStatsRow } from '@estimat/shared';
import { getAiTaskStats } from '../../../services/aiTasks';
import { fmtInt } from './aiTaskDicts';

const DAYS_OPTIONS = [
  { label: '7 дней', value: 7 },
  { label: '30 дней', value: 30 },
  { label: '90 дней', value: 90 },
  { label: 'Всё время', value: 3650 },
];

/** Успешность: отменённые и идущие в знаменатель не входят — они ещё не исход. */
function rate(succeeded: number, failed: number): string {
  const base = succeeded + failed;
  return base ? `${Math.round((succeeded / base) * 100)}%` : '—';
}

const tokenColumns = (labelTitle: string): ColumnsType<AiTaskStatsRow> => [
  { title: labelTitle, dataIndex: 'label', key: 'label', ellipsis: true },
  { title: 'Задач', dataIndex: 'tasks', key: 'tasks', width: 80, align: 'right', render: (v: number) => fmtInt(v) },
  {
    title: 'Успешно',
    dataIndex: 'succeeded',
    key: 'succeeded',
    width: 90,
    align: 'right',
    render: (v: number) => fmtInt(v),
  },
  {
    title: 'Ошибок',
    dataIndex: 'failed',
    key: 'failed',
    width: 84,
    align: 'right',
    render: (v: number) => (v ? <span style={{ color: 'var(--est-error-text)' }}>{fmtInt(v)}</span> : '—'),
  },
  {
    title: 'Успешность',
    key: 'rate',
    width: 104,
    align: 'right',
    render: (_v, r) => rate(r.succeeded, r.failed),
  },
  {
    title: 'Вызовов',
    dataIndex: 'calls',
    key: 'calls',
    width: 90,
    align: 'right',
    render: (v: number) => fmtInt(v),
  },
  {
    title: 'Вход',
    dataIndex: 'promptTokens',
    key: 'promptTokens',
    width: 100,
    align: 'right',
    render: (v: number | null) => fmtInt(v),
  },
  {
    title: 'Выход',
    dataIndex: 'completionTokens',
    key: 'completionTokens',
    width: 100,
    align: 'right',
    render: (v: number | null) => fmtInt(v),
  },
];

/** Сводка расхода и успешности. Тело модалки — канон ProjectStats. */
export function AiTasksStats({ enabled }: { enabled: boolean }) {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-tasks-stats', days],
    queryFn: () => getAiTaskStats(days),
    enabled,
  });

  if (error) return <Alert type="error" showIcon message={(error as Error).message} />;
  if (isLoading || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  const s = data.data;
  const t = s.totals;

  return (
    <div>
      <Segmented
        size="small"
        options={DAYS_OPTIONS}
        value={days}
        onChange={(v) => setDays(v as number)}
        style={{ marginBottom: 16 }}
      />

      <Row gutter={[16, 12]}>
        <Col xs={12} sm={6}>
          <Statistic title="Задач" value={t.tasks} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Успешно" value={t.succeeded} valueStyle={{ color: 'var(--est-success-text)' }} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Ошибок" value={t.failed} valueStyle={{ color: t.failed ? 'var(--est-error-text)' : undefined }} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Успешность" value={rate(t.succeeded, t.failed)} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Токенов всего" value={fmtInt((t.promptTokens ?? 0) + (t.completionTokens ?? 0))} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Вход" value={fmtInt(t.promptTokens)} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Выход" value={fmtInt(t.completionTokens)} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="Вызовов модели"
            value={fmtInt(t.calls)}
            suffix={t.callsFailed ? <span style={{ fontSize: 13, color: 'var(--est-error-text)' }}>· {t.callsFailed} с ошибкой</span> : undefined}
          />
        </Col>
      </Row>

      {/* Провайдер может не вернуть usage — тогда расход неизвестен, а не равен нулю. Молчать об
          этом нельзя: сводка выглядела бы просто заниженной. */}
      {t.callsWithoutUsage > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message={`По ${t.callsWithoutUsage} вызовам провайдер не вернул расход токенов — эти вызовы в суммы не вошли.`}
        />
      )}

      <Divider style={{ margin: '16px 0 8px' }} orientation="left">
        По типам
      </Divider>
      <Table
        className="estimat-compact"
        size="small"
        rowKey="key"
        columns={tokenColumns('Тип')}
        dataSource={s.byKind}
        pagination={false}
      />

      <Divider style={{ margin: '16px 0 8px' }} orientation="left">
        По пользователям
      </Divider>
      {s.byUser.length ? (
        <Table
          className="estimat-compact"
          size="small"
          rowKey="key"
          columns={tokenColumns('Пользователь')}
          dataSource={s.byUser}
          pagination={false}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных" />
      )}

      <Divider style={{ margin: '16px 0 8px' }} orientation="left">
        По моделям
      </Divider>
      {s.byModel.length ? (
        <Table
          className="estimat-compact"
          size="small"
          rowKey="key"
          columns={tokenColumns('Модель').filter((c) => c.key !== 'tasks' && c.key !== 'rate')}
          dataSource={s.byModel}
          pagination={false}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет данных" />
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 16 }}>
        Токены и вызовы учитываются только для задач, выполненных после включения журнала. Тексты
        запросов и ответов хранятся 7 дней, показатели расхода — весь срок жизни задачи.
      </Typography.Text>
    </div>
  );
}
