/**
 * Фабрика колонок таблицы работ. ЧИСТАЯ функция без хуков: вызывается внутри
 * существующего useMemo в CostTypeGroupBlock с прежним deps-массивом, ctx-объект
 * строится внутри колбэка useMemo — частота пересборки колонок не меняется.
 * Не объявлять компоненты внутри — только render-функции (иначе размонтирование
 * ячеек и потеря фокуса AutoComplete при пересборке).
 */
import type { Dispatch, SetStateAction } from 'react';
import { Table, Button, Popconfirm, Space, Tag, AutoComplete, InputNumber, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, CheckOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';
import { DragHandle } from '../../../components/dndSortable';
import { UnitSelect } from '../../../components/UnitSelect';
import { LocationCell } from './LocationCell';
import { RowInfoPopover } from './RowInfoPopover';
import { CommentsPopover } from './CommentsPopover';
import type { ZoneNode } from './location';
import type { CostTypeGroup, EstimateItem, PriceMode, SaveWorkPayload, WorkEdit } from './types';
import { formatMoney, formatMoneyOrDash, priceOf, totalOf, DRAFT_ID } from './types';
import type { ColumnPrefs } from '../../../store/smetaColumnsStore';

export interface WorksColumnsCtx {
  /** Группа вида затрат: нужны works.length (грип у единственной работы скрыт). */
  group: CostTypeGroup;
  editing: WorkEdit | null;
  setEditing: Dispatch<SetStateAction<WorkEdit | null>>;
  saving: boolean;
  nameOptions: Array<{ key: string; value: string; label: string }> | undefined;
  dndEnabled: boolean;
  leadingColumns: ColumnsType<EstimateItem>;
  editable: boolean;
  deleteMode: boolean;
  selectionMode: boolean;
  showPrices: boolean;
  /** Какие цены в столбцах «Цена»/«Сумма»: базовые из справочника или договорные из ВОР. */
  priceMode: PriceMode;
  showLocationColumn: boolean;
  zones: ZoneNode[];
  projectId: string;
  isRowInEdit: (r: EstimateItem) => boolean;
  isWorkExpanded: (id: string) => boolean;
  setWorkExpanded: (id: string, expanded: boolean) => void;
  commit: () => void;
  selectRate: (id: string) => void;
  startEditWork: (r: EstimateItem) => void;
  onUpdateWork: (workId: string, payload: SaveWorkPayload) => Promise<void>;
  onDeleteWork: (workId: string) => void;
  onConfirmWork: (workId: string) => void;
  onToggleVolumeType: (itemId: string, current: 'main' | 'additional') => void;
  onOpenHistory?: (item: EstimateItem) => void;
}

export function buildWorksColumns(ctx: WorksColumnsCtx): ColumnsType<EstimateItem> {
  const {
    group, editing, setEditing, saving, nameOptions, dndEnabled, leadingColumns,
    editable, deleteMode, selectionMode, showPrices, priceMode, showLocationColumn, zones, projectId,
    isRowInEdit, isWorkExpanded, setWorkExpanded, commit, selectRate, startEditWork,
    onUpdateWork, onDeleteWork, onConfirmWork, onToggleVolumeType, onOpenHistory,
  } = ctx;
  return [
    // Грип-колонка слева (только в режиме DnD). Грип скрыт у черновика и когда работа одна.
    ...(dndEnabled
      ? [{
          title: '', key: '__drag__', width: 32, align: 'center' as const,
          render: (_: unknown, r: EstimateItem) =>
            r.id === DRAFT_ID || group.works.length <= 1 ? null : <DragHandle disabled={!!editing} />,
        }]
      : []),
    ...leadingColumns,
    // Колонку раскрытия материалов ставим явно (иначе AntD вставит её самой левой, перед грипом).
    Table.EXPAND_COLUMN,
    { title: '№', key: '__num__', width: 36, render: (_v, r, i) => (r.id === DRAFT_ID ? '—' : i + 1) },
    {
      title: 'Наименование работы', key: 'description', dataIndex: 'description',
      // Клик по названию работы разворачивает/сворачивает её материалы — как кнопка «+».
      // onCell применяется и в editable, и в read-only режиме (у подрядчиков onRow не задан).
      onCell: (r) => ({
        onClick: (e) => {
          if (r.id === DRAFT_ID || isRowInEdit(r)) return;
          // не реагируем на клики по интерактиву внутри ячейки (теги «ИИ»/«не согласовано»,
          // поле автодополнения в режиме редактирования)
          if ((e.target as HTMLElement).closest('button, input, a, .ant-select, .ant-tag')) return;
          // гасим всплытие, чтобы НЕ сработал row-onClick (selectWork): клик по названию —
          // только сворачивание/разворачивание, без выделения работы
          e.stopPropagation();
          setWorkExpanded(r.id, !isWorkExpanded(r.id));
        },
        style: r.id === DRAFT_ID ? undefined : { cursor: 'pointer' },
      }),
      render: (v: string, r) => {
        if (isRowInEdit(r) && editing) {
          return (
            <AutoComplete
              style={{ width: '100%' }}
              value={editing.description}
              options={nameOptions}
              onChange={(t) => setEditing({ ...editing, description: t ?? '' })}
              onSelect={(_v, option) => {
                const id = (option as { key?: string }).key;
                if (id) selectRate(id);
              }}
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              placeholder="Наименование работы или выбор из справочника"
              autoFocus
            />
          );
        }
        // У черновика бейджей нет.
        if (r.id === DRAFT_ID) return v;
        // Бейдж типа объёма (осн/доп) — всегда; теги «ИИ»/«не согласовано» — пока работа не согласована.
        // Клик по «не согласовано» снимает needs_review; клик по бейджу объёма переключает осн/доп.
        const vt: 'main' | 'additional' = r.volume_type ?? 'main';
        const volumeClickable = editable && !deleteMode && !selectionMode && !editing;
        return (
          <div className="estimat-review-cell">
            <span className="estimat-review-name">{v}</span>
            <span className="estimat-review-tags">
              {r.needs_review && r.source === 'ai' && <Tag color="blue">ИИ</Tag>}
              {r.needs_review &&
                (editable ? (
                  <Tooltip title="Согласовать — снять «не согласовано»">
                    <Tag color="orange" style={{ cursor: 'pointer' }} onClick={() => onConfirmWork(r.id)}>
                      не согласовано
                    </Tag>
                  </Tooltip>
                ) : (
                  <Tag color="orange">не согласовано</Tag>
                ))}
              {volumeClickable ? (
                <Tooltip title="Переключить тип объёма (осн/доп)">
                  <Tag
                    color={vt === 'main' ? 'green' : 'gold'}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onToggleVolumeType(r.id, vt)}
                  >
                    {vt === 'main' ? 'осн' : 'доп'}
                  </Tag>
                </Tooltip>
              ) : (
                <Tag color={vt === 'main' ? 'green' : 'gold'}>{vt === 'main' ? 'осн' : 'доп'}</Tag>
              )}
            </span>
          </div>
        );
      },
    },
    { title: 'Ед.', key: 'unit', dataIndex: 'unit', width: 64, align: 'center', render: (v: string, r) =>
        isRowInEdit(r) && editing ? (
          <UnitSelect size="small" style={{ width: '100%' }} value={editing.unit || undefined} onChange={(val) => setEditing({ ...editing, unit: val ?? '' })} />
        ) : v,
    },
    { title: 'Кол-во', key: 'quantity', dataIndex: 'quantity', width: 76, align: 'center', render: (v: string, r) =>
        isRowInEdit(r) && editing ? (
          <InputNumber size="small" min={0} step={0.01} decimalSeparator="," style={{ width: '100%' }} value={editing.quantity} onChange={(val) => setEditing({ ...editing, quantity: Number(val ?? 0) })} onPressEnter={commit} />
        ) : <span className="estimat-qty-chip">{Number(v).toLocaleString('ru-RU')}</span>,
    },
    ...(showPrices
      ? [
          { title: 'Цена', key: 'unit_price', width: 95, align: 'right' as const, render: (_v: unknown, r: EstimateItem) =>
              isRowInEdit(r) && editing ? (
                <InputNumber size="small" min={0} step={0.01} decimalSeparator="," style={{ width: '100%' }} value={editing.unitPrice} onChange={(val) => setEditing({ ...editing, unitPrice: Number(val ?? 0) })} onPressEnter={commit} />
              ) : formatMoneyOrDash(priceOf(r, priceMode)),
          },
          { title: 'Сумма', key: 'total', width: 105, align: 'right' as const, render: (_v: unknown, r: EstimateItem) =>
              isRowInEdit(r) && editing ? <strong>{formatMoney(editing.quantity * editing.unitPrice)}</strong> : <strong>{formatMoneyOrDash(totalOf(r, priceMode))}</strong>,
          },
        ]
      : []),
    ...(showLocationColumn
      ? [{
          title: 'Местоположение', key: 'location', width: 237,
          render: (_: unknown, r: EstimateItem) => {
            if (r.id === DRAFT_ID) return null; // у черновика локация подставится из контекста добавления
            return (
              <LocationCell
                work={r}
                editable={editable && !deleteMode && !editing}
                zones={zones}
                projectId={projectId}
                onChange={({ locations, locationTypeName }) =>
                  onUpdateWork(r.id, {
                    costTypeId: r.cost_type_id,
                    rateId: r.rate_id,
                    description: r.description,
                    unit: r.unit,
                    quantity: Number(r.quantity),
                    unitPrice: Number(r.unit_price),
                    locations,
                    locationTypeName,
                    expectedVersion: r.version,
                  })
                }
              />
            );
          },
        }]
      : []),
    // Столбец «Прим.» — комментарии к работе (узкий, слева от действий).
    ...(editable && !deleteMode
      ? [{
          title: 'Прим.', key: 'comments', width: 44, align: 'center' as const,
          render: (_: unknown, r: EstimateItem) =>
            r.id === DRAFT_ID ? null : (
              <CommentsPopover
                estimateId={r.estimate_id}
                targetType="work"
                targetId={r.id}
                count={r.comment_count}
              />
            ),
        }]
      : []),
    ...(editable && !deleteMode
      ? [{
          title: '', key: 'actions', width: 96,
          render: (_: unknown, r: EstimateItem) => {
            if (isRowInEdit(r)) {
              return (
                <Space size={4}>
                  <Button type="primary" size="small" icon={<CheckOutlined />} loading={saving} onClick={commit} />
                  <Button size="small" icon={<CloseOutlined />} disabled={saving} onClick={() => setEditing(null)} />
                </Space>
              );
            }
            return (
              <Space size={4}>
                <Button type="text" size="small" icon={<EditOutlined />} disabled={!!editing}
                  onClick={() => startEditWork(r)} />
                <Popconfirm title="Удалить работу со всеми материалами?" onConfirm={() => onDeleteWork(r.id)}>
                  <Button type="text" size="small" danger disabled={!!editing} icon={<DeleteOutlined />} />
                </Popconfirm>
                {r.id !== DRAFT_ID && <RowInfoPopover item={r} onOpenHistory={onOpenHistory} />}
              </Space>
            );
          },
        }]
      : []),
  ];
}

// Служебные лидирующие колонки (грип, «№») — держим в начале в исходном порядке.
const SERVICE_LEADING_KEYS = new Set(['__drag__', '__num__']);

/**
 * Применить пользовательские настройки столбцов (видимость + порядок) к готовому массиву
 * колонок. Работает ТОЛЬКО по фактически присутствующим колонкам (comments/actions есть лишь
 * в edit-режиме). Служебные (грип/раскрытие/№) — в начале; «действия» — в конце; настраиваемые
 * переупорядочиваются по order и фильтруются по hidden. Незнакомые контентные колонки
 * (leadingColumns и т.п.) остаются на своих позициях (в лидирующем блоке).
 */
export function applyColumnPrefs(
  cols: ColumnsType<EstimateItem>,
  prefs: ColumnPrefs,
): ColumnsType<EstimateItem> {
  const leading: ColumnsType<EstimateItem> = [];
  const byKey = new Map<string, ColumnsType<EstimateItem>[number]>();
  let actionsCol: ColumnsType<EstimateItem>[number] | undefined;
  const orderSet = new Set(prefs.order);
  for (const c of cols) {
    const key = (c as { key?: string }).key;
    if (c === Table.EXPAND_COLUMN || (key && SERVICE_LEADING_KEYS.has(key))) { leading.push(c); continue; }
    if (key === 'actions') { actionsCol = c; continue; }
    if (key && orderSet.has(key)) { byKey.set(key, c); continue; }
    leading.push(c); // прочие (leadingColumns и т.п.) — по позиции
  }
  const middle = prefs.order
    .filter((k) => byKey.has(k) && !prefs.hidden[k])
    .map((k) => byKey.get(k)!);
  return actionsCol ? [...leading, ...middle, actionsCol] : [...leading, ...middle];
}
