import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Key,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Table,
  Button,
  Popconfirm,
  Popover,
  Space,
  Tag,
  AutoComplete,
  Input,
  InputNumber,
  Select,
  Tooltip,
  App,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ExpandableConfig } from 'antd/es/table/interface';
import {
  PlusOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  UserOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { DragHandle, SortableTableRow, SortableVerticalContext } from '../../../components/dndSortable';
import { UnitSelect } from '../../../components/UnitSelect';
import { WorkTreeSelect, type WorkOption } from './WorkTreeSelect';
import { useEstimateSelectionStore, type CostTypeCtx } from '../../../store/estimateSelectionStore';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { SyncRateNameModal, type SyncRateNameResolution } from './SyncRateNameModal';
import { LocationCell } from './LocationCell';
import { RowInfoPopover } from './RowInfoPopover';
import type { ZoneNode, LocationEntry } from './location';
import type { CostTypeGroup, EstimateItem, EstimateMaterial } from './types';
import { formatMoney } from './types';

const DRAFT_ID = '__draft__';

interface Rate {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  price: string;
}

interface Material {
  id: string;
  name: string;
  unit: string;
  unit_price: string;
}

interface Organization {
  id: string;
  name: string;
  type?: string;
}

export interface SaveWorkPayload {
  costTypeId: string | null;
  rateId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  // Локация (опционально): задаётся контекстом добавления или поповером строки.
  // locations — мультизона из поповера; zoneId/floorFrom/floorTo — legacy-контекст добавления.
  locations?: LocationEntry[];
  zoneId?: string | null;
  floorFrom?: number | null;
  floorTo?: number | null;
  roomTypeId?: string | null;
  // Произвольный «тип» строки (на всю работу). Пустая строка/null очищает тип.
  locationTypeName?: string | null;
}

export interface SaveMaterialPayload {
  materialId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

interface WorkEdit {
  workId: string | null;
  rateId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  // Исходные значения — чтобы поймать изменение названия существующей работы
  originalDescription: string;
  originalRateId: string | null;
}

interface MaterialEdit {
  materialId: string | null;
  refMaterialId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

// ============================================================
// Вложенная таблица материалов под работой
// ============================================================
function MaterialsSubTableImpl({
  work,
  editable,
  showPrices = true,
  onCreate,
  onUpdate,
  onDelete,
  onConfirm,
  onReassign,
  works = [],
  selectionMode = false,
  selectedIds,
  onToggleMaterial,
  deleteMode = false,
  workSelected = false,
}: {
  work: EstimateItem;
  editable: boolean;
  /** Показывать колонки «Цена»/«Сумма» (false — скрываем деньги, напр. для подрядчика). */
  showPrices?: boolean;
  onCreate: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  onUpdate: (materialId: string, payload: SaveMaterialPayload) => Promise<void>;
  onDelete: (materialId: string) => void;
  onConfirm: (materialId: string) => void;
  onReassign?: (materialId: string, itemId: string) => void;
  works?: WorkOption[];
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleMaterial?: (id: string, selected: boolean) => void;
  /** Режим массового удаления: скрывает действия материалов; чекбоксы материалов выбранной работы недоступны. */
  deleteMode?: boolean;
  workSelected?: boolean;
}) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState<MaterialEdit | null>(null);
  const [saving, setSaving] = useState(false);

  // При входе в режим выбора (перенос/удаление) закрываем незавершённое редактирование/черновик.
  useEffect(() => {
    if (selectionMode) setEditing(null);
  }, [selectionMode]);

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get<{ data: Material[] }>('/materials'),
    enabled: !!editing,
  });

  const rows: EstimateMaterial[] = useMemo(() => {
    const list = work.materials.map((m) =>
      editing && editing.materialId === m.id
        ? {
            ...m,
            material_id: editing.refMaterialId,
            description: editing.description,
            unit: editing.unit,
            quantity: String(editing.quantity),
            unit_price: String(editing.unitPrice),
            total: String(editing.quantity * editing.unitPrice),
          }
        : m,
    );
    if (editing && editing.materialId === null) {
      list.push({
        id: DRAFT_ID,
        item_id: work.id,
        material_id: editing.refMaterialId,
        description: editing.description,
        unit: editing.unit,
        quantity: String(editing.quantity),
        unit_price: String(editing.unitPrice),
        total: String(editing.quantity * editing.unitPrice),
        material_name: null,
        status: 'confirmed',
      });
    }
    return list;
  }, [work.materials, work.id, editing]);

  const isRowInEdit = (r: EstimateMaterial) =>
    !!editing && (r.id === DRAFT_ID || r.id === editing.materialId);

  const nameOptions = useMemo(
    () =>
      materialsData?.data.map((m) => ({
        key: m.id,
        value: m.name,
        label: `${m.name} · ${m.unit} · ${Number(m.unit_price ?? 0).toLocaleString('ru-RU')} ₽`,
      })),
    [materialsData],
  );

  function selectRef(id: string) {
    if (!editing) return;
    const mat = materialsData?.data.find((m) => m.id === id);
    if (mat) {
      setEditing({
        ...editing,
        refMaterialId: mat.id,
        description: mat.name,
        unit: mat.unit,
        unitPrice: Number(mat.unit_price ?? 0),
      });
    }
  }

  async function commit() {
    if (!editing || saving) return;
    const description = editing.description.trim();
    const unit = editing.unit.trim();
    if (!description) return message.warning('Укажите наименование материала');
    if (!unit) return message.warning('Укажите единицу измерения');
    if (!(editing.quantity > 0)) return message.warning('Количество должно быть больше 0');
    if (editing.unitPrice < 0) return message.warning('Цена не может быть отрицательной');

    const payload: SaveMaterialPayload = {
      materialId: editing.refMaterialId,
      description,
      unit,
      quantity: editing.quantity,
      unitPrice: editing.unitPrice,
    };
    setSaving(true);
    try {
      if (editing.materialId) await onUpdate(editing.materialId, payload);
      else await onCreate(work.id, payload);
      setEditing(null);
    } catch {
      /* ошибку покажет мутация */
    } finally {
      setSaving(false);
    }
  }

  const canReassign = !!onReassign && works.length > 1;
  // Кнопка переноса материала к другой работе (для ревью ИИ-извлечения).
  const reassignBtn = (r: EstimateMaterial) =>
    canReassign ? (
      <Popover
        trigger="click"
        title="Перенести материал к работе"
        content={
          <WorkTreeSelect works={works} excludeId={work.id} onPick={(id) => onReassign!(r.id, id)} />
        }
      >
        <Button type="text" size="small" title="Перенести к другой работе" icon={<SwapOutlined />} disabled={!!editing} />
      </Popover>
    ) : null;

  const columns = useMemo<ColumnsType<EstimateMaterial>>(() => [
    { title: 'Материал', dataIndex: 'description', render: (v: string, r) => {
        if (isRowInEdit(r) && editing) {
          return (
            <AutoComplete
              style={{ width: '100%' }}
              size="small"
              value={editing.description}
              options={nameOptions}
              onChange={(t) => setEditing({ ...editing, description: t ?? '' })}
              onSelect={(_v, option) => {
                const id = (option as { key?: string }).key;
                if (id) selectRef(id);
              }}
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              placeholder="Материал или выбор из справочника"
              autoFocus
            />
          );
        }
        // «предложение» (suggested) — отдельный механизм со своими кнопками ✓/✗.
        // Теги «ИИ» и «не согласовано» показываем только пока материал не согласован;
        // клик по «не согласовано» снимает needs_review (оба тега исчезают).
        if (r.status === 'suggested' || r.needs_review) {
          return (
            <div className="estimat-review-cell">
              <span className="estimat-review-name">{v}</span>
              <span className="estimat-review-tags">
                {r.status === 'suggested' && <Tag color="orange">предложение</Tag>}
                {r.source === 'ai' && r.needs_review && <Tag color="blue">ИИ</Tag>}
                {r.needs_review && (
                  editable ? (
                    <Tooltip title="Согласовать — снять «не согласовано»">
                      <Tag color="orange" style={{ cursor: 'pointer' }} onClick={() => onConfirm(r.id)}>
                        не согласовано
                      </Tag>
                    </Tooltip>
                  ) : (
                    <Tag color="orange">не согласовано</Tag>
                  )
                )}
              </span>
            </div>
          );
        }
        return v;
      },
    },
    { title: 'Ед.', dataIndex: 'unit', width: 64, align: 'center', render: (v: string, r) =>
        isRowInEdit(r) && editing ? (
          <UnitSelect size="small" style={{ width: '100%' }} value={editing.unit || undefined} onChange={(val) => setEditing({ ...editing, unit: val ?? '' })} />
        ) : v,
    },
    { title: 'Кол-во', dataIndex: 'quantity', width: 76, align: 'center', render: (v: string, r) =>
        isRowInEdit(r) && editing ? (
          <InputNumber size="small" min={0} step={0.01} decimalSeparator="," style={{ width: '100%' }} value={editing.quantity} onChange={(val) => setEditing({ ...editing, quantity: Number(val ?? 0) })} onPressEnter={commit} />
        ) : <span className="estimat-qty-chip">{Number(v).toLocaleString('ru-RU')}</span>,
    },
    ...(showPrices
      ? [
          { title: 'Цена', dataIndex: 'unit_price', width: 90, align: 'right' as const, render: (v: string, r: EstimateMaterial) =>
              isRowInEdit(r) && editing ? (
                <InputNumber size="small" min={0} step={0.01} decimalSeparator="," style={{ width: '100%' }} value={editing.unitPrice} onChange={(val) => setEditing({ ...editing, unitPrice: Number(val ?? 0) })} onPressEnter={commit} />
              ) : formatMoney(v),
          },
          { title: 'Сумма', dataIndex: 'total', width: 100, align: 'right' as const, render: (v: string, r: EstimateMaterial) =>
              isRowInEdit(r) && editing ? <strong>{formatMoney(editing.quantity * editing.unitPrice)}</strong> : <strong>{formatMoney(v)}</strong>,
          },
        ]
      : []),
    ...(editable && !deleteMode
      ? [{
          title: '', width: 64,
          render: (_: unknown, r: EstimateMaterial) => {
            if (isRowInEdit(r)) {
              return (
                <Space size={4}>
                  <Button type="primary" size="small" icon={<CheckOutlined />} loading={saving} onClick={commit} />
                  <Button size="small" icon={<CloseOutlined />} disabled={saving} onClick={() => setEditing(null)} />
                </Space>
              );
            }
            // Предложенный материал: подтвердить (✓) или отклонить (✗ — удаляется)
            if (r.status === 'suggested') {
              return (
                <Space size={4}>
                  <Button type="text" size="small" disabled={!!editing} title="Подтвердить материал"
                    icon={<CheckOutlined style={{ color: '#52c41a' }} />} onClick={() => onConfirm(r.id)} />
                  {reassignBtn(r)}
                  <Button type="text" size="small" danger disabled={!!editing} title="Отклонить предложение"
                    icon={<CloseOutlined />} onClick={() => onDelete(r.id)} />
                </Space>
              );
            }
            return (
              <Space size={4}>
                <Button type="text" size="small" icon={<EditOutlined />} disabled={!!editing}
                  onClick={() => setEditing({ materialId: r.id, refMaterialId: r.material_id, description: r.description, unit: r.unit, quantity: Number(r.quantity), unitPrice: Number(r.unit_price) })} />
                {reassignBtn(r)}
                <Popconfirm title="Удалить материал?" onConfirm={() => onDelete(r.id)}>
                  <Button type="text" size="small" danger disabled={!!editing} icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            );
          },
        }]
      : []),
  ], [
    editing, saving, nameOptions, materialsData, editable, deleteMode, showPrices,
    onConfirm, onDelete, onReassign, onUpdate, onCreate, works, work.id,
  ]);

  return (
    <div style={{ padding: '2px 0 2px 12px' }}>
      <Table
        rowKey="id"
        size="small"
        className="estimat-compact"
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: editable ? 'Материалов нет. Нажмите «Материал».' : 'Материалов нет.' }}
        rowClassName={(r) => (isRowInEdit(r) ? 'estimat-row-editing' : '')}
        rowSelection={
          selectionMode && editable && !editing
            ? {
                selectedRowKeys: work.materials.filter((m) => selectedIds?.has(m.id)).map((m) => m.id) as Key[],
                onChange: (keys: Key[]) => {
                  const set = new Set(keys.map(String));
                  work.materials.forEach((m) => onToggleMaterial?.(m.id, set.has(m.id)));
                },
                // В режиме удаления материалы выбранной работы уйдут каскадом — их выбор недоступен.
                getCheckboxProps: (r) => ({ disabled: r.id === DRAFT_ID || (deleteMode && workSelected) }),
              }
            : undefined
        }
      />
      {editable && !deleteMode && (
        <Button
          type="link"
          size="small"
          icon={<PlusOutlined />}
          disabled={!!editing}
          onClick={() => setEditing({ materialId: null, refMaterialId: null, description: '', unit: '', quantity: 1, unitPrice: 0 })}
          style={{ marginTop: 4 }}
        >
          Материал
        </Button>
      )}
    </div>
  );
}

// memo: при стабильных пропсах таблица материалов не пересобирается, когда родительский блок
// ререндерится по не связанной с ней причине.
const MaterialsSubTable = memo(MaterialsSubTableImpl);

type MaterialsSubTableProps = Parameters<typeof MaterialsSubTableImpl>[0];

// Высота строки в компактной таблице материалов (estimat-compact size="small"); выверена эмпирически.
const MATERIAL_ROW_H = 30;
const MATERIALS_HEADER_H = 36;
const MATERIALS_ADD_H = 28;

// Ленивая обёртка над таблицей материалов: пока раскрытая строка вне видимой области (+overscan),
// рендерим лёгкий placeholder расчётной высоты вместо тяжёлой таблицы. Это убирает фриз при
// массовом «развернуть всё»: монтируются только видимые таблицы материалов. После первого показа
// таблица остаётся смонтированной (повторный скролл к ней мгновенный).
function LazyMaterialsSubTable({
  scrollRootRef,
  ...props
}: MaterialsSubTableProps & { scrollRootRef?: RefObject<HTMLDivElement | null> }) {
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return; // уже смонтировали — наблюдать больше не нужно
    const el = placeholderRef.current;
    if (!el) return;
    // Если IntersectionObserver недоступен — монтируем сразу (безопасная деградация).
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { root: scrollRootRef?.current ?? null, rootMargin: '1000px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible, scrollRootRef]);

  if (visible) return <MaterialsSubTable {...props} />;

  const count = props.work.materials.length;
  const height = MATERIALS_HEADER_H + count * MATERIAL_ROW_H + (props.editable ? MATERIALS_ADD_H : 0);
  return <div ref={placeholderRef} style={{ height, padding: '2px 0 2px 12px' }} aria-hidden />;
}

// ============================================================
// Группа по виду затрат: работы + вложенные материалы + подрядчик
// ============================================================
interface Props {
  group: CostTypeGroup;
  index: number;
  editable: boolean;
  orgs?: Organization[];
  onCreateWork?: (costTypeId: string | null, payload: SaveWorkPayload) => Promise<void>;
  onUpdateWork?: (workId: string, payload: SaveWorkPayload) => Promise<void>;
  onDeleteWork?: (workId: string) => void;
  /** Перестановка работ внутри вида: полный список id работ в новом порядке. */
  onReorderWorks?: (orderedIds: string[]) => void;
  /** Показывать кнопки ↑/↓ у работ (выкл. в группировке «по локации»). */
  canReorderWorks?: boolean;
  onCreateMaterial?: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  onUpdateMaterial?: (materialId: string, payload: SaveMaterialPayload) => Promise<void>;
  onDeleteMaterial?: (materialId: string) => void;
  onConfirmMaterial?: (materialId: string) => void;
  /** Согласование ИИ-работы кликом по тегу «не согласовано» (снимает needs_review). */
  onConfirmWork?: (workId: string) => void;
  onReassignMaterial?: (materialId: string, itemId: string) => void;
  /** Все работы сметы — для выбора цели при переносе материала. */
  allWorks?: WorkOption[];
  /** Режим выбора (перенос/удаление): показывает чекбоксы у материалов. */
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleMaterial?: (id: string, selected: boolean) => void;
  /** Режим массового удаления: добавляет чекбоксы у работ и скрывает действия строк. */
  deleteMode?: boolean;
  selectedWorkIds?: Set<string>;
  onToggleWork?: (id: string, selected: boolean) => void;
  onSetContractor?: (costTypeId: string, contractorId: string) => void;
  onClearContractor?: (costTypeId: string) => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Управляемое сворачивание (для «свернуть/развернуть всё»). Если задан onToggleCollapsed —
   *  состояние берётся из collapsed, иначе используется внутренний стейт. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Управляемое раскрытие материалов работ (для поэтапного «свернуть/развернуть всё»).
   *  Если заданы оба — состояние берётся из expandedWorkIds, иначе внутренний стейт. */
  expandedWorkIds?: Set<string>;
  onWorkExpandChange?: (workId: string, expanded: boolean) => void;
  /** Показывать ли категорию в заголовке блока (false — когда категория уже в заголовке секции). */
  showCategoryInTitle?: boolean;
  /** Показывать колонку «Локация» (в группировке «по виду работ»). */
  showLocationColumn?: boolean;
  zones?: ZoneNode[];
  /** Объект строки — для автодополнения произвольных «типов» в поповере локации. */
  projectId?: string;
  /** Дополнительные колонки слева (перед «№»). Напр. «Исполнитель» в разделе «Подрядчики». */
  leadingColumns?: ColumnsType<EstimateItem>;
  /** Показывать колонки «Цена»/«Сумма» и сумму группы (false — скрываем деньги). */
  showPrices?: boolean;
  /** Дополнительный контент в шапке блока вида работ (напр. «Назначить на весь вид»). */
  headerExtra?: ReactNode;
  /** Scroll-контейнер сметы — root для IntersectionObserver ленивых материалов. Передаётся
   *  только на «Смете»; когда задан и нет режима выбора, материалы рендерятся лениво. */
  scrollRootRef?: RefObject<HTMLDivElement | null>;
  /** Открыть полную историю строки (единый Drawer живёт в SmetaPanel). */
  onOpenHistory?: (item: EstimateItem) => void;
}

const noopAsync = async () => {};
const noop = () => {};

function CostTypeGroupBlockImpl({
  group,
  index,
  editable,
  orgs,
  onCreateWork = noopAsync,
  onUpdateWork = noopAsync,
  onDeleteWork = noop,
  onReorderWorks = noop,
  canReorderWorks = false,
  onCreateMaterial = noopAsync,
  onUpdateMaterial = noopAsync,
  onDeleteMaterial = noop,
  onConfirmMaterial = noop,
  onConfirmWork = noop,
  onReassignMaterial,
  allWorks = [],
  selectionMode = false,
  selectedIds,
  onToggleMaterial,
  deleteMode = false,
  selectedWorkIds,
  onToggleWork,
  onSetContractor = noop,
  onClearContractor = noop,
  collapsible = false,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onToggleCollapsed,
  expandedWorkIds,
  onWorkExpandChange,
  showCategoryInTitle = true,
  showLocationColumn = false,
  zones = [],
  projectId = '',
  leadingColumns = [],
  showPrices = true,
  headerExtra,
  scrollRootRef,
  onOpenHistory,
}: Props) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState<WorkEdit | null>(null);
  const [saving, setSaving] = useState(false);

  // При входе в режим выбора (перенос/удаление) закрываем незавершённое редактирование/черновик работы.
  useEffect(() => {
    if (selectionMode) setEditing(null);
  }, [selectionMode]);
  // Ожидающее сохранение, пока открыта модалка синхронизации названия со справочником
  const [pendingSync, setPendingSync] = useState<SaveWorkPayload | null>(null);
  const [internalCollapsed, setInternalCollapsed] = useState(collapsible && defaultCollapsed);
  const collapsed = onToggleCollapsed ? !!controlledCollapsed : internalCollapsed;
  const toggleCollapsed = onToggleCollapsed ?? (() => setInternalCollapsed((c) => !c));
  const [expandedKeys, setExpandedKeys] = useState<readonly Key[]>([]);
  // Раскрытие материалов: управляемое (из родителя, для поэтапного «свернуть/развернуть всё»)
  // либо локальное (expandedKeys), если родитель не передал контроллеры.
  const materialsControlled = !!expandedWorkIds && !!onWorkExpandChange;
  const isWorkExpanded = (id: string) =>
    materialsControlled ? expandedWorkIds!.has(id) : expandedKeys.includes(id);
  const setWorkExpanded = (id: string, expanded: boolean) => {
    if (materialsControlled) onWorkExpandChange!(id, expanded);
    else setExpandedKeys((keys) => (expanded ? [...keys, id] : keys.filter((k) => k !== id)));
  };
  // Узкие подписки на selection-store: возвращают производные значения, относящиеся только к этому
  // блоку, поэтому клик по строке/шапке в ДРУГОМ виде работ не ререндерит этот блок.
  // selectedWorkId — id, только если выбранная работа принадлежит этой группе, иначе null.
  const selectedWorkId = useEstimateSelectionStore((s) =>
    s.selectedWorkId != null && group.works.some((w) => w.id === s.selectedWorkId) ? s.selectedWorkId : null,
  );
  // isActiveType — булев флаг активности именно этого вида работ.
  const isActiveType = useEstimateSelectionStore(
    (s) => !!group.costTypeId && s.activeCostTypeId === group.costTypeId,
  );
  const selectWork = useEstimateSelectionStore((s) => s.selectWork);
  const selectCostType = useEstimateSelectionStore((s) => s.selectCostType);
  const revealInRatesTree = useEstimateSelectionStore((s) => s.revealInRatesTree);
  const showArea = useWorkspaceLayoutStore((s) => s.showArea);
  const openSection = useWorkspaceLayoutStore((s) => s.openSection);

  // DnD-перестановка работ внутри вида. Грип и обёртка появляются только в редактируемой смете
  // вне режима выбора (delete/replicate — там чекбоксы массовых операций).
  const dndEnabled = editable && !deleteMode && canReorderWorks;

  // Контекст вида работ — для активации (клик по шапке/строке) и подсветки.
  const ctx: CostTypeCtx = {
    costTypeId: group.costTypeId,
    costTypeName: group.costTypeName,
    costCategoryId: group.costCategoryId,
    costCategoryName: group.costCategoryName,
  };
  const { data: ratesData } = useQuery({
    queryKey: ['rates', group.costTypeId],
    queryFn: () => api.get<{ data: Rate[] }>(`/rates?costTypeId=${encodeURIComponent(group.costTypeId ?? '')}`),
    enabled: !!editing && !!group.costTypeId,
  });

  const title =
    showCategoryInTitle && group.costCategoryName
      ? `${group.costCategoryName} / ${group.costTypeName ?? '—'}`
      : group.costTypeName ?? 'Без вида работ';

  const groupTotal = useMemo(
    () =>
      group.works.reduce(
        (acc, w) => acc + Number(w.total ?? 0) + w.materials.reduce((a, m) => a + Number(m.total ?? 0), 0),
        0,
      ),
    [group.works],
  );

  const rows: EstimateItem[] = useMemo(() => {
    const list = group.works.map((w) =>
      editing && editing.workId === w.id
        ? {
            ...w,
            rate_id: editing.rateId,
            description: editing.description,
            unit: editing.unit,
            quantity: String(editing.quantity),
            unit_price: String(editing.unitPrice),
            total: String(editing.quantity * editing.unitPrice),
          }
        : w,
    );
    if (editing && editing.workId === null) {
      list.push({
        id: DRAFT_ID,
        estimate_id: '',
        cost_category_id: group.costCategoryId,
        cost_type_id: group.costTypeId,
        rate_id: editing.rateId,
        description: editing.description,
        quantity: String(editing.quantity),
        unit: editing.unit,
        unit_price: String(editing.unitPrice),
        total: String(editing.quantity * editing.unitPrice),
        sort_order: 9999,
        rate_name: null,
        rate_code: null,
        materials: [],
      });
    }
    return list;
  }, [group.works, group.costCategoryId, group.costTypeId, editing]);

  // Ключи раскрытых строк для таблицы: в управляемом режиме — пересечение работ блока с общим набором.
  // Стабильная ссылка (useMemo) важна для AntD expandable, иначе Table переинициализирует раскрытие.
  const effectiveExpandedKeys: readonly Key[] = useMemo(
    () => (materialsControlled ? rows.filter((r) => expandedWorkIds!.has(r.id)).map((r) => r.id) : expandedKeys),
    [materialsControlled, rows, expandedWorkIds, expandedKeys],
  );

  const isRowInEdit = (r: EstimateItem) => !!editing && (r.id === DRAFT_ID || r.id === editing.workId);

  const nameOptions = useMemo(
    () =>
      ratesData?.data.map((r) => ({
        key: r.id,
        value: r.code ? `[${r.code}] ${r.name}` : r.name,
        label: `${r.code ? `[${r.code}] ` : ''}${r.name} · ${r.unit} · ${Number(r.price).toLocaleString('ru-RU')} ₽`,
      })),
    [ratesData],
  );

  function selectRate(id: string) {
    if (!editing) return;
    const rate = ratesData?.data.find((r) => r.id === id);
    if (rate) {
      setEditing({
        ...editing,
        rateId: rate.id,
        description: rate.code ? `[${rate.code}] ${rate.name}` : rate.name,
        unit: rate.unit,
        unitPrice: Number(rate.price),
      });
    }
  }

  // Открыть строку работы на редактирование (кнопка-карандаш или двойной клик).
  function startEditWork(r: EstimateItem) {
    setEditing({
      workId: r.id,
      rateId: r.rate_id,
      description: r.description,
      unit: r.unit,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unit_price),
      originalDescription: r.description,
      originalRateId: r.rate_id,
    });
  }

  // Перетащили работу за грип: вычисляем новый порядок и шлём полный список id.
  function onWorksDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = group.works.map((w) => w.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderWorks(arrayMove(ids, oldIndex, newIndex));
  }

  async function doSave(payload: SaveWorkPayload, workId: string | null) {
    setSaving(true);
    try {
      if (workId) await onUpdateWork(workId, payload);
      else await onCreateWork(group.costTypeId, payload);
      setEditing(null);
    } catch {
      /* ошибку покажет мутация */
    } finally {
      setSaving(false);
    }
  }

  async function commit() {
    if (!editing || saving) return;
    const description = editing.description.trim();
    const unit = editing.unit.trim();
    if (!description) return message.warning('Укажите наименование работы');
    if (!unit) return message.warning('Укажите единицу измерения');
    if (!(editing.quantity > 0)) return message.warning('Количество должно быть больше 0');
    if (editing.unitPrice < 0) return message.warning('Цена не может быть отрицательной');

    const payload: SaveWorkPayload = {
      costTypeId: group.costTypeId,
      rateId: editing.rateId,
      description,
      unit,
      quantity: editing.quantity,
      unitPrice: editing.unitPrice,
    };

    // Название существующей работы изменили вручную (не выбором другой расценки) —
    // уточняем, как поступить со справочником наименований.
    if (
      editing.workId &&
      description !== editing.originalDescription.trim() &&
      editing.rateId === editing.originalRateId
    ) {
      setPendingSync(payload);
      return;
    }

    await doSave(payload, editing.workId);
  }

  // Ответ модалки синхронизации: null — вернуться в редактирование без сохранения.
  async function resolveSync(resolution: SyncRateNameResolution | null) {
    const payload = pendingSync;
    setPendingSync(null);
    if (!resolution || !payload || !editing) return;
    await doSave({ ...payload, description: resolution.description, rateId: resolution.rateId }, editing.workId);
  }

  // Суммарная ширина лидирующих колонок (напр. «Исполнитель» в разделе «Подрядчики»).
  const leadingWidth = leadingColumns.reduce(
    (s, c) => s + (typeof c.width === 'number' ? c.width : 0),
    0,
  );
  // Когда есть лидирующие колонки, раскрытые материалы выравниваем под колонку «Наименование
  // работы»: ширина лидирующих колонок + колонка раскрытия (56) + «№» (36). На «Смете» — 0.
  const materialsIndent = leadingWidth ? leadingWidth + 56 + 36 : 0;

  const columns = useMemo<ColumnsType<EstimateItem>>(() => [
    // Грип-колонка слева (только в режиме DnD). Грип скрыт у черновика и когда работа одна.
    ...(dndEnabled
      ? [{
          title: '', width: 32, align: 'center' as const,
          render: (_: unknown, r: EstimateItem) =>
            r.id === DRAFT_ID || group.works.length <= 1 ? null : <DragHandle disabled={!!editing} />,
        }]
      : []),
    ...leadingColumns,
    // Колонку раскрытия материалов ставим явно (иначе AntD вставит её самой левой, перед грипом).
    Table.EXPAND_COLUMN,
    { title: '№', width: 36, render: (_v, r, i) => (r.id === DRAFT_ID ? '—' : i + 1) },
    {
      title: 'Наименование работы', dataIndex: 'description',
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
        // Теги «ИИ» и «не согласовано» показываем только пока работа не согласована.
        // Клик по «не согласовано» снимает needs_review (оба тега исчезают).
        if (r.needs_review) {
          return (
            <div className="estimat-review-cell">
              <span className="estimat-review-name">{v}</span>
              <span className="estimat-review-tags">
                {r.source === 'ai' && <Tag color="blue">ИИ</Tag>}
                {editable ? (
                  <Tooltip title="Согласовать — снять «не согласовано»">
                    <Tag color="orange" style={{ cursor: 'pointer' }} onClick={() => onConfirmWork(r.id)}>
                      не согласовано
                    </Tag>
                  </Tooltip>
                ) : (
                  <Tag color="orange">не согласовано</Tag>
                )}
              </span>
            </div>
          );
        }
        return v;
      },
    },
    { title: 'Ед.', dataIndex: 'unit', width: 64, align: 'center', render: (v: string, r) =>
        isRowInEdit(r) && editing ? (
          <UnitSelect size="small" style={{ width: '100%' }} value={editing.unit || undefined} onChange={(val) => setEditing({ ...editing, unit: val ?? '' })} />
        ) : v,
    },
    { title: 'Кол-во', dataIndex: 'quantity', width: 76, align: 'center', render: (v: string, r) =>
        isRowInEdit(r) && editing ? (
          <InputNumber size="small" min={0} step={0.01} decimalSeparator="," style={{ width: '100%' }} value={editing.quantity} onChange={(val) => setEditing({ ...editing, quantity: Number(val ?? 0) })} onPressEnter={commit} />
        ) : <span className="estimat-qty-chip">{Number(v).toLocaleString('ru-RU')}</span>,
    },
    ...(showPrices
      ? [
          { title: 'Цена', dataIndex: 'unit_price', width: 95, align: 'right' as const, render: (v: string, r: EstimateItem) =>
              isRowInEdit(r) && editing ? (
                <InputNumber size="small" min={0} step={0.01} decimalSeparator="," style={{ width: '100%' }} value={editing.unitPrice} onChange={(val) => setEditing({ ...editing, unitPrice: Number(val ?? 0) })} onPressEnter={commit} />
              ) : formatMoney(v),
          },
          { title: 'Сумма', dataIndex: 'total', width: 105, align: 'right' as const, render: (v: string, r: EstimateItem) =>
              isRowInEdit(r) && editing ? <strong>{formatMoney(editing.quantity * editing.unitPrice)}</strong> : <strong>{formatMoney(v)}</strong>,
          },
        ]
      : []),
    ...(showLocationColumn
      ? [{
          title: 'Местоположение', width: 237,
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
                  })
                }
              />
            );
          },
        }]
      : []),
    ...(editable && !deleteMode
      ? [{
          title: '', width: 96,
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
    // editing/saving/expandedWorkIds в deps гарантируют свежесть замыкаемых функций
    // (commit/selectRate/setWorkExpanded/isWorkExpanded); ESLint-deps выверены вручную.
  ], [
    dndEnabled, group.works.length, group.costTypeId, leadingColumns,
    editing, saving, nameOptions, ratesData,
    editable, deleteMode, showPrices, showLocationColumn, zones, projectId,
    materialsControlled, expandedWorkIds, expandedKeys, onWorkExpandChange,
    onCreateWork, onUpdateWork, onDeleteWork, onConfirmWork, onOpenHistory,
  ]);

  const contractorOptions = orgs
    ?.filter((o) => o.type === 'subcontractor' || o.type === 'general_contractor')
    .map((o) => ({ value: o.id, label: o.name }));

  // Стабильный объект components: без useMemo AntD пересоздаёт обёртку строки при каждом рендере.
  const tableComponents = useMemo(
    () => (dndEnabled ? { body: { row: SortableTableRow } } : undefined),
    [dndEnabled],
  );

  // Ленивый рендер материалов — только на «Смете» (задан scrollRootRef) и вне режима выбора
  // (в режиме чекбоксов таблицы нужны сразу, чтобы не усложнять массовый выбор/перенос).
  const useLazyMaterials = !!scrollRootRef && !selectionMode && !deleteMode;

  const expandable = useMemo<ExpandableConfig<EstimateItem>>(
    () => ({
      expandedRowKeys: effectiveExpandedKeys,
      onExpand: (expanded, record) => setWorkExpanded(record.id, expanded),
      rowExpandable: (r) => r.id !== DRAFT_ID,
      columnWidth: 56,
      // Кастомная иконка раскрытия: штатная кнопка «+/−» + число материалов работы,
      // чтобы по свёрнутой строке было видно, есть ли материалы и сколько их.
      expandIcon: ({ expanded, onExpand, record }) => {
        if (record.id === DRAFT_ID) return <span style={{ display: 'inline-block', width: 17 }} />;
        const count = record.materials?.length ?? 0;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className={`ant-table-row-expand-icon ant-table-row-expand-icon-${expanded ? 'expanded' : 'collapsed'}`}
              aria-label={expanded ? 'Свернуть' : 'Развернуть'}
              onClick={(e) => onExpand(record, e)}
            />
            {count > 0 && (
              <span className="estimat-mat-count" title={`Материалов: ${count}`}>{count}</span>
            )}
          </span>
        );
      },
      expandedRowRender: (r) => (
        <div style={{ marginLeft: materialsIndent }}>
          {useLazyMaterials ? (
            <LazyMaterialsSubTable
              scrollRootRef={scrollRootRef}
              work={r}
              editable={editable}
              showPrices={showPrices}
              onCreate={onCreateMaterial}
              onUpdate={onUpdateMaterial}
              onDelete={onDeleteMaterial}
              onConfirm={onConfirmMaterial}
              onReassign={onReassignMaterial}
              works={allWorks}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleMaterial={onToggleMaterial}
              deleteMode={deleteMode}
              workSelected={!!selectedWorkIds?.has(r.id)}
            />
          ) : (
            <MaterialsSubTable
              work={r}
              editable={editable}
              showPrices={showPrices}
              onCreate={onCreateMaterial}
              onUpdate={onUpdateMaterial}
              onDelete={onDeleteMaterial}
              onConfirm={onConfirmMaterial}
              onReassign={onReassignMaterial}
              works={allWorks}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleMaterial={onToggleMaterial}
              deleteMode={deleteMode}
              workSelected={!!selectedWorkIds?.has(r.id)}
            />
          )}
        </div>
      ),
    }),
    [
      effectiveExpandedKeys, materialsControlled, onWorkExpandChange, materialsIndent,
      useLazyMaterials, scrollRootRef, editable, showPrices,
      onCreateMaterial, onUpdateMaterial, onDeleteMaterial, onConfirmMaterial, onReassignMaterial,
      allWorks, selectionMode, selectedIds, onToggleMaterial, deleteMode, selectedWorkIds,
    ],
  );

  return (
    <div
      className={`estimat-cv-block${isActiveType ? ' estimat-group-active' : ''}`}
      style={{ background: '#fff', borderRadius: 8, marginBottom: 8, border: '1px solid #f0f0f0' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && editing && !saving) {
          e.stopPropagation();
          setEditing(null);
        }
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          background: '#fafbfc',
          borderBottom: collapsible && collapsed ? 'none' : '1px solid #f0f0f0',
          gap: 10,
          cursor: group.costTypeId ? 'pointer' : 'default',
          userSelect: 'none',
        }}
        title={group.costTypeId ? 'Клик — выделить вид работ; двойной клик — показать в справочнике' : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, .ant-select, .ant-popover, .ant-popconfirm, .estimat-caret')) return;
          if (group.costTypeId) selectCostType(ctx);
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button, .ant-select, .ant-popover, .ant-popconfirm, .estimat-caret')) return;
          if (!group.costTypeId) return;
          showArea('refs');
          openSection('works');
          revealInRatesTree(group.costCategoryId, group.costTypeId);
        }}
      >
        {collapsible && (
          <span
            className="estimat-caret"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed();
            }}
            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', color: '#8c8c8c' }}
            title={collapsed ? 'Развернуть' : 'Свернуть'}
          >
            {collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
          </span>
        )}
        <strong style={{ fontSize: 13 }}>{index + 1}. {title}</strong>

        {editable && group.costTypeId ? (
          <Select
            size="small"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Подрядчик по виду работ (общий)"
            title="Общий подрядчик на весь вид работ. Построчное распределение — в разделе «Подрядчики»."
            style={{ minWidth: 240 }}
            value={group.contractor?.contractor_id}
            options={contractorOptions}
            onChange={(val) => {
              if (val) onSetContractor(group.costTypeId!, val);
              else onClearContractor(group.costTypeId!);
            }}
            suffixIcon={<UserOutlined />}
          />
        ) : (
          group.contractor?.contractor_name && (
            <Tag icon={<UserOutlined />} color="purple">{group.contractor.contractor_name}</Tag>
          )
        )}

        {headerExtra}
        <span style={{ flex: 1 }} />
        {showPrices && <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(groupTotal)}</span>}
        {editable && !deleteMode && (
          <Button type="primary" size="small" icon={<PlusOutlined />} disabled={!!editing} onClick={() => setEditing({ workId: null, rateId: null, description: '', unit: '', quantity: 1, unitPrice: 0, originalDescription: '', originalRateId: null })}>
            Работа
          </Button>
        )}
      </div>

      {!(collapsible && collapsed) && (
        <SortableVerticalContext
          enabled={dndEnabled}
          items={group.works.map((w) => w.id)}
          onDragEnd={onWorksDragEnd}
        >
        <Table
          rowKey="id"
          size="small"
          className="estimat-compact"
          components={tableComponents}
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: editable ? 'Нет работ. Нажмите «Работа».' : 'Нет работ.' }}
          rowClassName={(r) =>
            [
              isRowInEdit(r) ? 'estimat-row-editing' : '',
              editable && r.id === selectedWorkId ? 'estimat-row-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')
          }
          rowSelection={
            deleteMode && editable && !editing
              ? {
                  selectedRowKeys: group.works.filter((w) => selectedWorkIds?.has(w.id)).map((w) => w.id) as Key[],
                  onChange: (keys: Key[]) => {
                    const set = new Set(keys.map(String));
                    group.works.forEach((w) => onToggleWork?.(w.id, set.has(w.id)));
                  },
                  getCheckboxProps: (r) => ({ disabled: r.id === DRAFT_ID }),
                }
              : undefined
          }
          onRow={
            editable && !deleteMode
              ? (r) => ({
                  onClick: (e) => {
                    if (r.id === DRAFT_ID || isRowInEdit(r)) return;
                    if (
                      (e.target as HTMLElement).closest(
                        '.ant-table-row-expand-icon, button, input, .ant-select, .ant-input-number, .ant-popover, .ant-popconfirm',
                      )
                    )
                      return;
                    selectWork(r.id, r.description, ctx);
                  },
                  // Двойной клик по строке — режим редактирования работы
                  onDoubleClick: (e) => {
                    if (r.id === DRAFT_ID || isRowInEdit(r) || editing) return;
                    if (
                      (e.target as HTMLElement).closest(
                        '.ant-table-row-expand-icon, button, input, .ant-select, .ant-input-number, .ant-popover, .ant-popconfirm',
                      )
                    )
                      return;
                    startEditWork(r);
                  },
                })
              : undefined
          }
          expandable={expandable}
        />
        </SortableVerticalContext>
      )}

      {editing && (
        <SyncRateNameModal
          open={!!pendingSync}
          oldName={editing.originalDescription}
          newName={pendingSync?.description ?? editing.description}
          rateId={editing.rateId}
          costTypeId={group.costTypeId}
          unit={pendingSync?.unit ?? editing.unit}
          unitPrice={pendingSync?.unitPrice ?? editing.unitPrice}
          onResolve={resolveSync}
        />
      )}
    </div>
  );
}

// React.memo: при стабильных пропсах (стабилизированы колбэки в EstimateEditor + useMemo blockProps
// в SmetaPanel) блок не ререндерится при операциях в других видах работ. Раскрытие/выбор приходят
// узкими подписками внутри компонента — затрагивается только изменившийся блок.
export const CostTypeGroupBlock = memo(CostTypeGroupBlockImpl);
