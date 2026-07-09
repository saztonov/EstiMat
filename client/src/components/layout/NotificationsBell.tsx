import { useState } from 'react';
import { Badge, Button, Popover, List, Empty, Typography } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';

const { Text } = Typography;

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payment_request_id: string | null;
  is_read: boolean;
  created_at: string;
}

export function NotificationsBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Счётчик непрочитанных — лёгкий опрос (persistent-уведомления, realtime не обязателен).
  const countQ = useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => api.get<{ data: { unread: number } }>('/notifications/count'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const unread = countQ.data?.data.unread ?? 0;

  const listQ = useQuery({
    queryKey: ['notifications-list'],
    queryFn: () => api.get<{ data: NotificationRow[] }>('/notifications'),
    enabled: open,
  });

  async function markRead(id: string) {
    await api.post(`/notifications/${id}/read`);
    queryClient.invalidateQueries({ queryKey: ['notifications-count'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
  }
  async function markAll() {
    await api.post('/notifications/read-all');
    queryClient.invalidateQueries({ queryKey: ['notifications-count'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
  }

  const content = (
    <div style={{ width: 340, maxHeight: 420, overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <Button type="link" size="small" onClick={markAll} disabled={unread === 0}>
          Прочитать все
        </Button>
      </div>
      <List
        size="small"
        loading={listQ.isLoading}
        locale={{ emptyText: <Empty description="Уведомлений нет" /> }}
        dataSource={listQ.data?.data ?? []}
        renderItem={(n) => (
          <List.Item
            style={{ cursor: n.is_read ? 'default' : 'pointer', opacity: n.is_read ? 0.6 : 1 }}
            onClick={() => !n.is_read && markRead(n.id)}
          >
            <List.Item.Meta
              title={<Text strong={!n.is_read}>{n.title}</Text>}
              description={
                <>
                  {n.body && <div>{n.body}</div>}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(n.created_at).toLocaleString('ru-RU')}
                  </Text>
                </>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="bottomRight">
      <Badge count={unread} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          icon={<BellOutlined style={{ fontSize: 18 }} />}
          aria-label="Уведомления"
        />
      </Badge>
    </Popover>
  );
}
