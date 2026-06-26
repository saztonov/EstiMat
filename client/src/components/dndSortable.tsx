import { createContext, useContext, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { Button } from 'antd';
import { HolderOutlined } from '@ant-design/icons';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Маркер строки-черновика в таблице сметы (добавляемая работа) — не делаем сортируемым.
const DRAFT_ID = '__draft__';

// Поля из useSortable, которые нужны handle'у. attributes обязательны для keyboard-a11y dnd-kit.
type SortableHandle = Pick<
  ReturnType<typeof useSortable>,
  'attributes' | 'listeners' | 'setActivatorNodeRef'
>;

// Контекст пробрасывает activator-привязки из строки/элемента к <DragHandle/> внутри неё.
const RowContext = createContext<Partial<SortableHandle>>({});

// Единый набор сенсоров для всех DnD-списков: мышь (порог 5px, чтобы клик по грипу не считался drag)
// + клавиатура (Space — взять, стрелки — двигать, Space — отпустить).
export function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

// Вертикальный сортируемый контекст для одного списка. При enabled=false — прозрачная обёртка
// (рендерит детей как есть). Перетаскивание ограничено вертикалью и границами контейнера.
export function SortableVerticalContext({
  enabled,
  items,
  onDragEnd,
  children,
}: {
  enabled: boolean;
  items: string[];
  onDragEnd: (e: DragEndEvent) => void;
  children: ReactNode;
}) {
  const sensors = useDndSensors();
  if (!enabled) return <>{children}</>;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

// Маркер-грип: единственный элемент строки, несущий listeners — перетаскивание стартует только с него.
// stopPropagation на click — чтобы захват не запускал row-onClick (выбор работы/категории).
export function DragHandle({ disabled }: { disabled?: boolean }) {
  const { attributes, listeners, setActivatorNodeRef } = useContext(RowContext);
  return (
    <Button
      type="text"
      size="small"
      ref={setActivatorNodeRef}
      icon={<HolderOutlined />}
      disabled={disabled}
      title="Перетащить"
      style={{ cursor: disabled ? 'not-allowed' : 'grab', touchAction: 'none' }}
      onClick={(e) => e.stopPropagation()}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
    />
  );
}

type TableRowProps = HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: string };

// Строка для antd <Table components={{ body: { row: SortableTableRow } }}>.
// Раскрытые строки материалов (нет data-row-key / класс ant-table-expanded-row) и черновик
// рендерим обычным <tr>, чтобы не плодить дубли sortable-id.
export function SortableTableRow(props: TableRowProps) {
  const key = props['data-row-key'];
  const className = props.className ?? '';
  if (!key || key === DRAFT_ID || className.includes('ant-table-expanded-row')) {
    return <tr {...props} />;
  }
  return <SortableTr rowKey={key} {...props} />;
}

function SortableTr({ rowKey, ...props }: TableRowProps & { rowKey: string }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: rowKey });
  const style: CSSProperties = {
    ...props.style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 9999 } : {}),
  };
  return (
    <RowContext.Provider value={{ attributes, listeners, setActivatorNodeRef }}>
      <tr {...props} ref={setNodeRef} style={style} />
    </RowContext.Provider>
  );
}

interface SortableItemProps extends HTMLAttributes<HTMLDivElement> {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}

// Сортируемая строка-<div> для списков (модалка «Категории и виды работ»).
// Форвардит style/onClick/className; activator-привязки идут к <DragHandle/> через контекст.
export function SortableItem({ id, disabled, children, style, ...rest }: SortableItemProps) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  const mergedStyle: CSSProperties = {
    ...style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 9999 } : {}),
  };
  return (
    <RowContext.Provider value={{ attributes, listeners, setActivatorNodeRef }}>
      <div ref={setNodeRef} style={mergedStyle} {...rest}>
        {children}
      </div>
    </RowContext.Provider>
  );
}
