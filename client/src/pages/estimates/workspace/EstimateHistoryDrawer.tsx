import { Drawer, Timeline, Empty, Spin, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getEstimateHistory } from '../../../services/estimateHistory';
import { ACTION_LABEL, ACTION_COLOR, describe, changedRows } from '../components/auditView';

interface Props {
  estimateId: string;
  /** Если задан — история конкретной строки (работы/материала). */
  entityId?: string;
  title?: string;
  open: boolean;
  onClose: () => void;
}

export function EstimateHistoryDrawer({ estimateId, entityId, title, open, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['estimate-history', estimateId, entityId ?? null],
    queryFn: () => getEstimateHistory(estimateId, { entityId }),
    enabled: open,
  });
  const items = data?.data ?? [];

  return (
    <Drawer title={title ?? 'История изменений'} open={open} onClose={onClose} width={460} destroyOnClose>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет записей" />
      ) : (
        <Timeline
          items={items.map((e) => ({
            color: ACTION_COLOR[e.action] ?? 'gray',
            children: (
              <div>
                <div style={{ fontSize: 13 }}>
                  {describe(e)} <Tag color={ACTION_COLOR[e.action]}>{ACTION_LABEL[e.action] ?? e.action}</Tag>
                </div>
                {changedRows(e).map((c, idx) => (
                  <Typography.Text key={idx} type="secondary" style={{ fontSize: 12, display: 'block' }}>
                    {c.label}: {c.before} → {c.after}
                  </Typography.Text>
                ))}
                <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                  {new Date(e.createdAt).toLocaleString('ru-RU')}
                </Typography.Text>
              </div>
            ),
          }))}
        />
      )}
    </Drawer>
  );
}
