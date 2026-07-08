import { Button, Checkbox, Popover, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { DragHandle, SortableItem, SortableVerticalContext } from '../../../components/dndSortable';
import { SMETA_COLUMN_DEFS, useSmetaColumnsStore, resolveColumnPrefs } from '../../../store/smetaColumnsStore';

const LABELS = new Map(SMETA_COLUMN_DEFS.map((d) => [d.key, d.label]));
const REQUIRED = new Map(SMETA_COLUMN_DEFS.map((d) => [d.key, !!d.required]));

// Поповер настройки столбцов сметы: чекбоксы видимости + перетаскивание за грип для порядка.
// Обязательные столбцы (Наименование/Ед./Кол-во) нельзя скрыть — чекбокс заблокирован.
export function ColumnSettingsPopover() {
  const order = useSmetaColumnsStore((s) => s.order);
  const hidden = useSmetaColumnsStore((s) => s.hidden);
  const setOrder = useSmetaColumnsStore((s) => s.setOrder);
  const setHidden = useSmetaColumnsStore((s) => s.setHidden);
  const reset = useSmetaColumnsStore((s) => s.reset);

  // Нормализованный порядок (известные ключи + новые в конец) — на нём строим список.
  const prefs = resolveColumnPrefs(order, hidden);

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
        Видимость и порядок столбцов. Перетаскивайте за ⠿.
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
                disabled={REQUIRED.get(key)}
                onChange={(e) => setHidden(key, !e.target.checked)}
              >
                {LABELS.get(key) ?? key}
              </Checkbox>
            </SortableItem>
          ))}
        </SortableVerticalContext>
      </div>
      <div style={{ textAlign: 'right', marginTop: 8 }}>
        <Button size="small" onClick={reset}>Сбросить</Button>
      </div>
    </div>
  );

  return (
    <Popover trigger="click" placement="bottomRight" title="Настройка столбцов" content={content}>
      <Button icon={<SettingOutlined />} title="Настройка столбцов" />
    </Popover>
  );
}
