import { Drawer, Timeline, Typography } from 'antd';
import { APP_VERSION, CHANGELOG } from '../../../changelog';

interface Props {
  open: boolean;
  onClose: () => void;
}

// 'YYYY-MM-DD' → 'DD.MM.YYYY' без new Date(): парсинг ISO-даты как UTC
// сдвигает день в западных таймзонах.
function formatDate(date: string) {
  return date.split('-').reverse().join('.');
}

export function VersionHistoryDrawer({ open, onClose }: Props) {
  return (
    <Drawer title="История версий" open={open} onClose={onClose} width={460} destroyOnClose>
      <Typography.Paragraph strong style={{ fontSize: 15 }}>
        Текущая версия: {APP_VERSION}
      </Typography.Paragraph>

      <Timeline
        items={CHANGELOG.map((entry) => ({
          children: (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {entry.version}{' '}
                <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                  — {formatDate(entry.date)}
                </Typography.Text>
              </div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {entry.changes.map((change, idx) => (
                  <li key={idx} style={{ fontSize: 13 }}>
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          ),
        }))}
      />
    </Drawer>
  );
}
