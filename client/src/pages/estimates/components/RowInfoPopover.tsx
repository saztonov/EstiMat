import { useState } from 'react';
import { Popover, Button, Typography, Spin, Divider } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getEstimateHistory } from '../../../services/estimateHistory';
import { ACTION_LABEL, changedRows } from './auditView';
import type { EstimateItem } from './types';

interface Props {
  item: EstimateItem;
  /** Открыть полную историю этой строки (единый Drawer живёт выше, в SmetaPanel). */
  onOpenHistory?: (item: EstimateItem) => void;
}

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU') : '—');

// Инфо-поповер строки сметы: создатель/время создания + суть последней содержательной
// правки (ленивый запрос истории при открытии) + ссылка на полную историю строки.
export function RowInfoPopover({ item, onOpenHistory }: Props) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['estimate-history', item.estimate_id, item.id, 'last'],
    queryFn: () => getEstimateHistory(item.estimate_id, { entityId: item.id, limit: 20 }),
    enabled: open,
  });

  // Записи отсортированы по времени DESC — берём самую свежую с понятными изменениями
  // (update с changesView; create/confirm/reassign без деталей пропускаем).
  const entries = data?.data ?? [];
  const lastEdit = entries.find((e) => changedRows(e).length > 0);
  // Фолбэк: история недоступна/пуста, но дата изменения позже создания — строку правили.
  const wasEdited = !!item.updated_at && item.updated_at !== item.created_at;
  // «Создал»: имя автора, если известно; иначе для ИИ-строк (в т.ч. легаси без created_by) —
  // «ИИ-ассистент»; иначе прочерк.
  const creator = item.created_by_name ?? (item.source === 'ai' ? 'ИИ-ассистент' : '—');

  const content = (
    <div style={{ minWidth: 240, maxWidth: 340, fontSize: 13 }}>
      <div>
        Создал: <strong>{creator}</strong>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {fmt(item.created_at)}
      </Typography.Text>

      <Divider style={{ margin: '8px 0' }} />

      <div style={{ marginBottom: 4 }}>
        <strong>Последняя правка</strong>
      </div>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          <Spin size="small" />
        </div>
      ) : lastEdit ? (
        <div>
          <div>
            {lastEdit.userName ?? 'Система'} {ACTION_LABEL[lastEdit.action] ?? lastEdit.action}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            {fmt(lastEdit.createdAt)}
          </Typography.Text>
          {changedRows(lastEdit).map((c, idx) => (
            <Typography.Text key={idx} type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {c.label}: {c.before} → {c.after}
            </Typography.Text>
          ))}
        </div>
      ) : wasEdited ? (
        <div>
          <div>Изменил: {item.updated_by_name ?? '—'}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {fmt(item.updated_at)}
          </Typography.Text>
        </div>
      ) : (
        <Typography.Text type="secondary">Правок пока нет</Typography.Text>
      )}

      {onOpenHistory && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <Typography.Link
            onClick={() => {
              setOpen(false);
              onOpenHistory(item);
            }}
          >
            Вся история
          </Typography.Link>
        </>
      )}
    </div>
  );

  return (
    <Popover trigger="click" title="Информация о строке" content={content} open={open} onOpenChange={setOpen}>
      <Button type="text" size="small" icon={<InfoCircleOutlined />} title="Информация о строке" />
    </Popover>
  );
}
