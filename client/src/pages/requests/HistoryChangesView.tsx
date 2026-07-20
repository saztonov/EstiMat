import { Space, Tag, Typography } from 'antd';
import { describeChanges } from './historyChanges';

const { Text } = Typography;

/**
 * Детали записи истории заявки: комментарий, короткие факты и пометка о перезаказе.
 * Разбор — в historyChanges.ts (чистая функция под тесты), здесь только отображение.
 */
export function HistoryChanges({ action, changes }: {
  action: string;
  changes: Record<string, unknown> | null;
}) {
  const d = describeChanges(action, changes);
  if (!d) return null;

  return (
    <Space direction="vertical" size={0} style={{ marginTop: 2 }}>
      {d.quote && (
        <Text italic type="secondary" style={{ fontSize: 12 }}>«{d.quote}»</Text>
      )}
      {d.facts.map((f) => (
        <Text key={f} type="secondary" style={{ fontSize: 12 }}>{f}</Text>
      ))}
      {d.warn && <Tag color="red" style={{ marginTop: 2 }}>{d.warn}</Tag>}
    </Space>
  );
}
