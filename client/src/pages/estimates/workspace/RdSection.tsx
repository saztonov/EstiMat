import { Empty } from 'antd';
import { SectionShell } from './SectionShell';

interface Props {
  collapsed?: boolean;
  onToggle?: () => void;
}

// «Рабочая документация» — заглушка. Таблиц РД ещё нет; в будущем сюда
// подтянутся распознанные страницы чертежей (markdown) из внешнего портала.
export function RdSection({ collapsed, onToggle }: Props) {
  return (
    <SectionShell title="Рабочая документация" meta="скоро" collapsed={collapsed} onToggle={onToggle}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span style={{ fontSize: 12.5, color: '#8c8c8c' }}>
            Рабочая документация будет подтягиваться из портала распознавания чертежей (markdown).
          </span>
        }
        style={{ marginTop: 12 }}
      />
    </SectionShell>
  );
}
