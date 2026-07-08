import {
  memo,
  useEffect,
  useMemo,
  useState,
  type Key,
  type ReactNode,
  type RefObject,
} from 'react';
import { Table, Button, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ExpandableConfig } from 'antd/es/table/interface';
import { PlusOutlined, CaretRightOutlined, CaretDownOutlined } from '@ant-design/icons';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../../services/api';
import { SortableTableRow, SortableVerticalContext } from '../../../components/dndSortable';
import type { WorkOption } from './WorkTreeSelect';
import { useEstimateSelectionStore, type CostTypeCtx } from '../../../store/estimateSelectionStore';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { MaterialsSubTable, LazyMaterialsSubTable } from './MaterialsSubTable';
import { buildWorksColumns, applyColumnPrefs } from './worksColumns';
import { CommentsPopover } from './CommentsPopover';
import { CostTypeCipherSelect } from './CostTypeCipherSelect';
import type { ColumnPrefs } from '../../../store/smetaColumnsStore';
import type { ZoneNode } from './location';
import type { CostTypeGroup, EstimateItem, Organization, SaveWorkPayload, SaveMaterialPayload, WorkEdit } from './types';
import { formatMoney, DRAFT_ID } from './types';

interface Rate {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  price: string;
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
  /** Переключение типа объёма (осн/доп) кликом по бейджу в ячейке наименования. */
  onToggleVolumeType?: (itemId: string, current: 'main' | 'additional') => void;
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
  /** Смета — для комментариев к виду работ (иконка-конверт в заголовке блока). */
  estimateId?: string;
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
  /** Настройки столбцов (порядок/видимость) — применяются только на «Смете». */
  columnPrefs?: ColumnPrefs;
  /** Право редактировать шифры РД у вида работ (роль admin/engineer). */
  canEditCiphers?: boolean;
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
  onToggleVolumeType = noop,
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
  estimateId,
  columnPrefs,
  canEditCiphers = false,
}: Props) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState<WorkEdit | null>(null);
  const [saving, setSaving] = useState(false);

  // При входе в режим выбора (перенос/удаление) закрываем незавершённое редактирование/черновик работы.
  useEffect(() => {
    if (selectionMode) setEditing(null);
  }, [selectionMode]);
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
      expectedVersion: r.version,
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
    } catch (e) {
      // OCC-конфликт: строку изменил другой пользователь. Форму НЕ закрываем (черновик
      // сохраняется), а обновляем version из ответа — повторное «сохранить» осознанно
      // ляжет поверх. Предупреждение и подтягивание данных уже сделала мутация.
      if (e instanceof ApiError && e.status === 409) {
        const v = (e.data as { version?: number } | undefined)?.version;
        if (typeof v === 'number') setEditing((prev) => (prev ? { ...prev, expectedVersion: v } : prev));
      }
      /* прочие ошибки покажет мутация */
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
      expectedVersion: editing.expectedVersion,
    };

    // Переименование сохраняется как есть: справочник наименований (rates) не трогаем.
    await doSave(payload, editing.workId);
  }

  // Суммарная ширина лидирующих колонок (напр. «Исполнитель» в разделе «Подрядчики»).
  const leadingWidth = leadingColumns.reduce(
    (s, c) => s + (typeof c.width === 'number' ? c.width : 0),
    0,
  );
  // Когда есть лидирующие колонки, раскрытые материалы выравниваем под колонку «Наименование
  // работы»: ширина лидирующих колонок + колонка раскрытия (56) + «№» (36). На «Смете» — 0.
  const materialsIndent = leadingWidth ? leadingWidth + 56 + 36 : 0;

  // Ctx-объект строится ВНУТРИ колбэка useMemo (не снаружи) — свежие замыкания
  // commit/selectRate/setWorkExpanded/isWorkExpanded захватываются в тот же момент, что и раньше.
  // editing/saving/expandedWorkIds в deps гарантируют свежесть замыкаемых функций;
  // ESLint-deps выверены вручную — deps-массив БЕЗ ИЗМЕНЕНИЙ.
  const columns = useMemo<ColumnsType<EstimateItem>>(
    () => {
      const built = buildWorksColumns({
        group, editing, setEditing, saving, nameOptions, dndEnabled, leadingColumns,
        editable, deleteMode, selectionMode, showPrices, showLocationColumn, zones, projectId,
        isRowInEdit, isWorkExpanded, setWorkExpanded, commit, selectRate, startEditWork,
        onUpdateWork, onDeleteWork, onConfirmWork, onToggleVolumeType, onOpenHistory,
      });
      // Пользовательские порядок/видимость столбцов — только на «Смете» (передан columnPrefs).
      return columnPrefs ? applyColumnPrefs(built, columnPrefs) : built;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      dndEnabled, group.works.length, group.costTypeId, leadingColumns,
      editing, saving, nameOptions, ratesData,
      editable, deleteMode, selectionMode, showPrices, showLocationColumn, zones, projectId,
      materialsControlled, expandedWorkIds, expandedKeys, onWorkExpandChange,
      onCreateWork, onUpdateWork, onDeleteWork, onConfirmWork, onToggleVolumeType, onOpenHistory,
      columnPrefs,
    ],
  );


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
        // Фиксированный бокс 17×17 (как заглушка черновика), счётчик — вне потока,
        // чтобы позиция «+» не зависела от наличия материалов.
        return (
          <span className="estimat-expand-icon-wrap">
            <button
              type="button"
              className={`ant-table-row-expand-icon ant-table-row-expand-icon-${expanded ? 'expanded' : 'collapsed'}`}
              aria-label={expanded ? 'Свернуть' : 'Развернуть'}
              onClick={(e) => onExpand(record, e)}
            />
            {count > 0 && (
              <span className="estimat-mat-count estimat-mat-count--floating" title={`Материалов: ${count}`}>{count}</span>
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

        {headerExtra}
        {editable && !deleteMode && estimateId && group.costTypeId && group.works.length > 0 && (
          <CommentsPopover
            estimateId={estimateId}
            targetType="cost_type"
            targetId={group.costTypeId}
            count={group.commentCount}
          />
        )}
        {estimateId && projectId && group.costTypeId && (
          <CostTypeCipherSelect
            estimateId={estimateId}
            projectId={projectId}
            costTypeId={group.costTypeId}
            value={group.ciphers ?? []}
            canEdit={canEditCiphers && !deleteMode}
          />
        )}
        <span style={{ flex: 1 }} />
        {showPrices && <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(groupTotal)}</span>}
        {editable && !deleteMode && (
          <Button type="primary" size="small" icon={<PlusOutlined />} disabled={!!editing} onClick={() => setEditing({ workId: null, rateId: null, description: '', unit: '', quantity: 1, unitPrice: 0 })}>
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
    </div>
  );
}

// React.memo: при стабильных пропсах (стабилизированы колбэки в EstimateEditor + useMemo blockProps
// в SmetaPanel) блок не ререндерится при операциях в других видах работ. Раскрытие/выбор приходят
// узкими подписками внутри компонента — затрагивается только изменившийся блок.
export const CostTypeGroupBlock = memo(CostTypeGroupBlockImpl);
