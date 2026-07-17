import { Alert, Descriptions, Tag, Typography } from 'antd';
import { Link } from 'react-router';
import type { AiTaskItem } from '@estimat/shared';
import {
  TASK_KIND,
  TASK_STATUS,
  fmtDateTimeFull,
  fmtDuration,
  fmtInt,
  fmtUsers,
  totalTokens,
} from './aiTaskDicts';

/** Почему расход неизвестен. Пустая колонка «Токены» не должна выглядеть поломкой журнала. */
function tokensNote(task: AiTaskItem): string | null {
  if (totalTokens(task) != null) return null;
  if (task.hasFallback) {
    return 'В сессии есть ответы без вызова модели: без настроенного провайдера чат отвечает поиском по справочнику.';
  }
  if (!task.callsTotal) {
    return 'Журнал вызовов по этой задаче пуст — она выполнялась до его включения.';
  }
  return 'Провайдер не вернул расход токенов по этим вызовам.';
}

export function AiTaskSummary({ task }: { task: AiTaskItem }) {
  const note = tokensNote(task);
  const tokens = totalTokens(task);

  return (
    <div style={{ overflow: 'auto', paddingRight: 4 }}>
      {task.error && (
        <Alert type="error" showIcon message="Ошибка" description={task.error} style={{ marginBottom: 12 }} />
      )}
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Тип">
          <Tag color={TASK_KIND[task.kind].color}>{TASK_KIND[task.kind].full}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Статус">
          <Tag color={TASK_STATUS[task.status]?.color}>{TASK_STATUS[task.status]?.label ?? task.status}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {task.rawStatus}
          </Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="Задача" span={2}>
          {task.title}
          {task.subtitle && (
            <Typography.Text type="secondary"> · {task.subtitle}</Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Проект">{task.projectName || '—'}</Descriptions.Item>
        <Descriptions.Item label="Смета">
          {task.estimateId ? (
            <Link to={`/estimates/${task.estimateId}`} target="_blank">
              Открыть смету
            </Link>
          ) : (
            '—'
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Запустил">{fmtUsers(task.users, task.kind)}</Descriptions.Item>
        <Descriptions.Item label="Создано">{fmtDateTimeFull(task.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="Последняя активность">
          {fmtDateTimeFull(task.activityAt)}
        </Descriptions.Item>
        <Descriptions.Item label="Длительность">{fmtDuration(task.durationMs)}</Descriptions.Item>
        <Descriptions.Item label="Модель" span={2}>
          {task.models.length ? (
            task.models.map((m) => (
              <Typography.Text code key={m}>
                {m}
              </Typography.Text>
            ))
          ) : (
            '—'
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Вызовов модели">
          {task.callsTotal ? `${task.callsOk} из ${task.callsTotal}` : '—'}
          {task.httpAttempts > task.callsTotal && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {' '}
              · HTTP-попыток: {task.httpAttempts}
            </Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Итог">{task.resultSummary || '—'}</Descriptions.Item>
        <Descriptions.Item label="Токены" span={2}>
          {tokens != null
            ? `Вход: ${fmtInt(task.promptTokens)} · Выход: ${fmtInt(task.completionTokens)} · Всего: ${fmtInt(tokens)}`
            : '—'}
          {note && (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {note}
              </Typography.Text>
            </div>
          )}
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}
