import { Tag, Typography } from 'antd';
import { asText, type LlmMessage } from './aiTaskDicts';

const ROLE: Record<string, { label: string; color: string }> = {
  system: { label: 'Система', color: 'default' },
  user: { label: 'Запрос', color: 'blue' },
  assistant: { label: 'Ответ', color: 'green' },
  tool: { label: 'Функция', color: 'orange' },
};

interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** arguments у OpenAI — строка с JSON. Разбираем для читаемости; мусор показываем как есть. */
function prettyArgs(a: string | undefined): string {
  if (!a) return '';
  try {
    return JSON.stringify(JSON.parse(a), null, 2);
  } catch {
    return a;
  }
}

/** Одно сообщение диалога: роль, текст и вызовы инструментов. */
export function LlmMessageView({ m }: { m: LlmMessage }) {
  const r = ROLE[m.role ?? ''] ?? { label: m.role ?? '—', color: 'default' };
  const text = asText(m.content);
  const toolCalls = (Array.isArray(m.tool_calls) ? m.tool_calls : []) as ToolCall[];

  return (
    <div className="ai-log-msg">
      <div className="ai-log-msg__head">
        <Tag color={r.color} style={{ marginInlineEnd: 0 }}>
          {r.label}
        </Tag>
        {m.name && (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {m.name}
          </Typography.Text>
        )}
        <span style={{ flex: 1 }} />
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {text.length.toLocaleString('ru-RU')} симв.
        </Typography.Text>
        {!!text && <Typography.Text copyable={{ text, tooltips: ['Копировать', 'Скопировано'] }} />}
      </div>
      {!!text && <pre className="ai-log-pre">{text}</pre>}
      {toolCalls.map((tc, i) => (
        <div key={tc.id ?? i} style={{ marginTop: 4 }}>
          <div className="ai-log-msg__head">
            <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
              вызов функции
            </Tag>
            <Typography.Text code style={{ fontSize: 11 }}>
              {tc.function?.name ?? '—'}
            </Typography.Text>
          </div>
          <pre className="ai-log-pre">{prettyArgs(tc.function?.arguments)}</pre>
        </div>
      ))}
    </div>
  );
}
