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

// Содержимое поповера вынесено в отдельный компонент и монтируется ТОЛЬКО когда поповер открыт.
// Пока запрос жил в самой ячейке, на смете в 500 строк создавалось столько же наблюдателей
// react-query (пусть и с enabled: false) и на каждый рендер дерева заново строилась вся эта
// разметка — при том что открыт поповер всегда максимум один.
function RowInfoContent({ item, onOpenHistory, onClose }: Props & { onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['estimate-history', item.estimate_id, item.id, 'last'],
    queryFn: () => getEstimateHistory(item.estimate_id, { entityId: item.id, limit: 20 }),
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

  return (
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
              onClose();
              onOpenHistory(item);
            }}
          >
            Вся история
          </Typography.Link>
        </>
      )}
    </div>
  );
}

// Инфо-поповер строки сметы: создатель/время создания + суть последней содержательной
// правки (ленивый запрос истории при открытии) + ссылка на полную историю строки.
export function RowInfoPopover({ item, onOpenHistory }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      trigger="click"
      title="Информация о строке"
      content={
        open ? <RowInfoContent item={item} onOpenHistory={onOpenHistory} onClose={() => setOpen(false)} /> : null
      }
      open={open}
      onOpenChange={setOpen}
    >
      <Button type="text" size="small" icon={<InfoCircleOutlined />} title="Информация о строке" />
    </Popover>
  );
}
