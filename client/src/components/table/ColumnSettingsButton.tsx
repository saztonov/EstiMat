import { Button, Checkbox, Popover, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { DragHandle, SortableItem, SortableVerticalContext } from '../dndSortable';
import type { TableColumnsStore } from '../../store/createColumnsStore';

// Кнопка настройки столбцов списковой таблицы (правая часть тулбара): чекбоксы видимости +
// перетаскивание за грип для порядка + «По умолчанию». Generic-аналог поповера смет
// (ColumnSettingsPopover), работает с любым store из createTableColumnsStore.
// required-столбцы («Действия», ключевые колонки) нельзя скрыть — чекбокс заблокирован.
export function ColumnSettingsButton({ store }: { store: TableColumnsStore }) {
  const useColumnsStore = store.useStore;
  const order = useColumnsStore((s) => s.order);
  const hidden = useColumnsStore((s) => s.hidden);
  const setOrder = useColumnsStore((s) => s.setOrder);
  const setHidden = useColumnsStore((s) => s.setHidden);
  const reset = useColumnsStore((s) => s.reset);

  const labels = new Map(store.defs.map((d) => [d.key, d.label]));
  const required = new Map(store.defs.map((d) => [d.key, !!d.required]));
  const prefs = store.resolve(order, hidden);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = prefs.order;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setOrder(arrayMove(ids, oldIndex, newIndex));
  };

  const content = (
    <div style={{ width: 260 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Видимость и порядок столбцов. Перетаскивайте за ⠿. Порядок задаёт и уровни дерева.
      </Typography.Text>
      <div style={{ marginTop: 8 }}>
        <SortableVerticalContext enabled items={prefs.order} onDragEnd={onDragEnd}>
          {prefs.order.map((key) => (
            <SortableItem
              key={key}
              id={key}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 4px', borderRadius: 6 }}
            >
              <DragHandle />
              <Checkbox
                checked={!prefs.hidden[key]}
                disabled={required.get(key)}
                onChange={(e) => setHidden(key, !e.target.checked)}
              >
                {labels.get(key) ?? key}
              </Checkbox>
            </SortableItem>
          ))}
        </SortableVerticalContext>
      </div>
      <div style={{ textAlign: 'right', marginTop: 8 }}>
        <Button size="small" onClick={reset}>По умолчанию</Button>
      </div>
    </div>
  );

  return (
    <Popover trigger="click" placement="bottomRight" title="Настройка столбцов" content={content}>
      <Button icon={<SettingOutlined />} title="Настройка столбцов" />
    </Popover>
  );
}
