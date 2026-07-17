import { useEffect, useMemo, useState } from 'react';
import { Alert, Collapse, Empty, Space, Spin, Tag, Typography } from 'antd';
import type { AiTaskCallSummary, AiTaskItem, AiTaskTurn } from '@estimat/shared';
import { CALL_KIND, CALL_STATUS, fmtDateTimeFull, fmtDuration, fmtInt, shortModel } from './aiTaskDicts';
import { AiLogCall } from './AiLogCall';

const BAD = new Set(['failed', 'timed_out', 'empty']);

/** Заголовок вызова: этап, модель, расход, время и исход — одной строкой. */
function callLabel(c: AiTaskCallSummary, index: number) {
  const kind = CALL_KIND[c.kind] ?? c.kind;
  const name = c.batchIndex != null ? `${kind} ${c.batchIndex + 1}` : kind;
  const st = CALL_STATUS[c.status] ?? { label: c.status, color: 'default' };
  return (
    <Space size={6} wrap style={{ fontSize: 12 }}>
      <Typography.Text type="secondary">#{index + 1}</Typography.Text>
      <span>{name}</span>
      {c.model && (
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {shortModel(c.model)}
        </Typography.Text>
      )}
      {c.totalTokens != null && (
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {fmtInt(c.promptTokens)} → {fmtInt(c.completionTokens)} тк
        </Typography.Text>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {fmtDuration(c.durationMs)}
      </Typography.Text>
      {c.httpStatus != null && c.httpStatus >= 400 && <Tag color="red">HTTP {c.httpStatus}</Tag>}
      {/* Больше одной попытки — это уже история: шлюз отвечал отказом. */}
      {c.httpAttempts > 1 && <Tag>попыток: {c.httpAttempts}</Tag>}
      <Tag color={st.color}>{st.label}</Tag>
    </Space>
  );
}

interface Props {
  task: AiTaskItem;
  calls: AiTaskCallSummary[];
  turns: AiTaskTurn[];
  loading: boolean;
  error: Error | null;
}

/**
 * Журнал общения с моделью.
 *
 * Виртуализации нет намеренно: вызовов десятки, а тело свёрнутой панели Collapse вообще не
 * попадает в DOM — этого достаточно. Элементы тут разной высоты (от трёх строк до десятков
 * килобайт), а это худший случай для виртуализации: измерение высот дало бы прыгающий скролл.
 */
export function AiTaskCallsLog({ task, calls, turns, loading, error }: Props) {
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  // Раскрываем сразу то, ради чего журнал и открывают: единственный вызов либо первый упавший.
  useEffect(() => {
    if (!calls.length) return;
    if (calls.length === 1) {
      setOpenKeys([calls[0]!.id]);
      return;
    }
    const bad = calls.find((c) => BAD.has(c.status) || c.error);
    if (bad) setOpenKeys([bad.id]);
  }, [calls]);

  const totals = useMemo(() => {
    const tok = calls.reduce<number | null>(
      (s, c) => (c.totalTokens == null ? s : (s ?? 0) + c.totalTokens),
      null,
    );
    return { calls: calls.length, tokens: tok };
  }, [calls]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }
  if (error) return <Alert type="error" showIcon message={error.message} />;

  if (!calls.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          task.hasFallback
            ? 'Модель не вызывалась: без настроенного провайдера чат отвечает поиском по справочнику'
            : 'Журнал пуст — задача выполнялась до его включения'
        }
      />
    );
  }

  const panel = (c: AiTaskCallSummary, i: number) => ({
    key: c.id,
    label: callLabel(c, i),
    children: <AiLogCall callId={c.id} open={openKeys.includes(c.id)} />,
  });

  // У чата вызовы группируются по ходам: один ответ агента — до 8 обращений к модели, и без
  // разбивки они выглядят россыпью. У остальных контуров ход один, группировать нечего.
  const body =
    task.kind === 'chat' && turns.length > 0 ? (
      <div>
        {turns.map((t, ti) => {
          const own = calls.filter((c) => c.turnId === t.id);
          return (
            <div key={t.id} style={{ marginBottom: 12 }}>
              <Space size={6} wrap style={{ marginBottom: 4 }}>
                <Typography.Text strong style={{ fontSize: 12 }}>
                  Ход {ti + 1}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {fmtDateTimeFull(t.createdAt)}
                </Typography.Text>
                {t.userName && (
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {t.userName}
                  </Typography.Text>
                )}
                {t.executionMode === 'fallback' && <Tag color="default">без вызова модели</Tag>}
                {t.error && <Tag color="red">ошибка</Tag>}
              </Space>
              {t.prompt && (
                <Typography.Paragraph
                  type="secondary"
                  ellipsis={{ rows: 2, expandable: true, symbol: 'ещё' }}
                  style={{ fontSize: 12, marginBottom: 4 }}
                >
                  {t.prompt}
                </Typography.Paragraph>
              )}
              {own.length ? (
                <Collapse
                  size="small"
                  activeKey={openKeys}
                  onChange={(k) => setOpenKeys(k as string[])}
                  items={own.map(panel)}
                />
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t.executionMode === 'fallback'
                    ? 'Ответ собран из справочника, модель не вызывалась.'
                    : 'Вызовов модели по этому ходу не записано.'}
                </Typography.Text>
              )}
            </div>
          );
        })}
      </div>
    ) : (
      <Collapse
        size="small"
        activeKey={openKeys}
        onChange={(k) => setOpenKeys(k as string[])}
        items={calls.map(panel)}
      />
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <Space size={12} style={{ flexShrink: 0, marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Вызовов: {totals.calls}
          {totals.tokens != null && ` · Токенов: ${fmtInt(totals.tokens)}`}
        </Typography.Text>
        <a onClick={() => setOpenKeys(calls.map((c) => c.id))}>Развернуть всё</a>
        <a onClick={() => setOpenKeys([])}>Свернуть всё</a>
      </Space>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{body}</div>
    </div>
  );
}
