import { Typography } from 'antd';

export interface ChangeRow {
  label: string;
  before: string | null;
  after: string | null;
}

// Список изменений «поле: было → стало» — единый вид для истории строки и diff ВОР.
export function ChangeList({ rows }: { rows: ChangeRow[] }) {
  return (
    <>
      {rows.map((c, i) => (
        <Typography.Text key={i} type="secondary" style={{ fontSize: 12, display: 'block' }}>
          {c.label}: {c.before ?? '—'} → {c.after ?? '—'}
        </Typography.Text>
      ))}
    </>
  );
}
