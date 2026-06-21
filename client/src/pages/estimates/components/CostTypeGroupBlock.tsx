import { useEffect, useState, type Key } from 'react';
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
  App,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
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
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { UnitSelect } from '../../../components/UnitSelect';
import { WorkTreeSelect, type WorkOption } from './WorkTreeSelect';
import { useEstimateSelectionStore, type CostTypeCtx } from '../../../store/estimateSelectionStore';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { SyncRateNameModal, type SyncRateNameResolution } from './SyncRateNameModal';
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
function MaterialsSubTable({
  work,
  editable,
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

  const rows: EstimateMaterial[] = work.materials.map((m) =>
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
    rows.push({
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

  const isRowInEdit = (r: EstimateMaterial) =>
    !!editing && (r.id === DRAFT_ID || r.id === editing.materialId);

  const nameOptions = materialsData?.data.map((m) => ({
    key: m.id,
    value: m.name,
    label: `${m.name} · ${m.unit} · ${Number(m.unit_price ?? 0).toLocaleString('ru-RU')} ₽`,
  }));

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

  const columns: ColumnsType<EstimateMaterial> = [
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
        if (r.status === 'suggested' || r.source === 'ai' || r.needs_review) {
          return (
            <Space size={6}>
              <span>{v}</span>
              {r.status === 'suggested' && <Tag color="orange" style={{ marginInlineEnd: 0 }}>предложение</Tag>}
              {r.source === 'ai' && <Tag color="blue" style={{ marginInlineEnd: 0 }}>ИИ</Tag>}
              {r.needs_review && <Tag color="orange" style={{ marginInlineEnd: 0 }}>не согласовано</Tag>}
            </Space>
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
    { title: 'Цена', dataIndex: 'unit_price', width: 90, align: 'right', render: (v: string, r) =>
        isRowInEdit(r) && editing ? (
          <InputNumber size="small" min={0} step={0.01} decimalSeparator="," style={{ width: '100%' }} value={editing.unitPrice} onChange={(val) => setEditing({ ...editing, unitPrice: Number(val ?? 0) })} onPressEnter={commit} />
        ) : formatMoney(v),
    },
    { title: 'Сумма', dataIndex: 'total', width: 100, align: 'right', render: (v: string, r) =>
        isRowInEdit(r) && editing ? <strong>{formatMoney(editing.quantity * editing.unitPrice)}</strong> : <strong>{formatMoney(v)}</strong>,
    },
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
  ];

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
  onCreateMaterial?: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  onUpdateMaterial?: (materialId: string, payload: SaveMaterialPayload) => Promise<void>;
  onDeleteMaterial?: (materialId: string) => void;
  onConfirmMaterial?: (materialId: string) => void;
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
  /** Показывать ли категорию в заголовке блока (false — когда категория уже в заголовке секции). */
  showCategoryInTitle?: boolean;
}

const noopAsync = async () => {};
const noop = () => {};

export function CostTypeGroupBlock({
  group,
  index,
  editable,
  orgs,
  onCreateWork = noopAsync,
  onUpdateWork = noopAsync,
  onDeleteWork = noop,
  onCreateMaterial = noopAsync,
  onUpdateMaterial = noopAsync,
  onDeleteMaterial = noop,
  onConfirmMaterial = noop,
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
  showCategoryInTitle = true,
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
  const selectedWorkId = useEstimateSelectionStore((s) => s.selectedWorkId);
  const selectWork = useEstimateSelectionStore((s) => s.selectWork);
  const activeCostTypeId = useEstimateSelectionStore((s) => s.activeCostTypeId);
  const selectCostType = useEstimateSelectionStore((s) => s.selectCostType);
  const revealInRatesTree = useEstimateSelectionStore((s) => s.revealInRatesTree);
  const showArea = useWorkspaceLayoutStore((s) => s.showArea);
  const openSection = useWorkspaceLayoutStore((s) => s.openSection);

  // Контекст вида работ — для активации (клик по шапке/строке) и подсветки.
  const ctx: CostTypeCtx = {
    costTypeId: group.costTypeId,
    costTypeName: group.costTypeName,
    costCategoryId: group.costCategoryId,
    costCategoryName: group.costCategoryName,
  };
  const isActiveType = !!group.costTypeId && group.costTypeId === activeCostTypeId;

  const { data: ratesData } = useQuery({
    queryKey: ['rates', group.costTypeId],
    queryFn: () => api.get<{ data: Rate[] }>(`/rates?costTypeId=${encodeURIComponent(group.costTypeId ?? '')}`),
    enabled: !!editing && !!group.costTypeId,
  });

  const title =
    showCategoryInTitle && group.costCategoryName
      ? `${group.costCategoryName} / ${group.costTypeName ?? '—'}`
      : group.costTypeName ?? 'Без вида работ';

  const groupTotal = group.works.reduce(
    (acc, w) => acc + Number(w.total ?? 0) + w.materials.reduce((a, m) => a + Number(m.total ?? 0), 0),
    0,
  );

  const rows: EstimateItem[] = group.works.map((w) =>
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
    rows.push({
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

  const isRowInEdit = (r: EstimateItem) => !!editing && (r.id === DRAFT_ID || r.id === editing.workId);

  const nameOptions = ratesData?.data.map((r) => ({
    key: r.id,
    value: r.code ? `[${r.code}] ${r.name}` : r.name,
    label: `${r.code ? `[${r.code}] ` : ''}${r.name} · ${r.unit} · ${Number(r.price).toLocaleString('ru-RU')} ₽`,
  }));

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

  const columns: ColumnsType<EstimateItem> = [
    { title: '№', width: 36, render: (_v, r, i) => (r.id === DRAFT_ID ? '—' : i + 1) },
    {
      title: 'Наименование работы', dataIndex: 'description',
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
        if (r.source === 'ai' || r.needs_review) {
          return (
            <Space size={6}>
              <span>{v}</span>
              {r.source === 'ai' && <Tag color="blue" style={{ marginInlineEnd: 0 }}>ИИ</Tag>}
              {r.needs_review && <Tag color="orange" style={{ marginInlineEnd: 0 }}>не согласовано</Tag>}
            </Space>
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
    { title: 'Цена', dataIndex: 'unit_price', width: 95, align: 'right', render: (v: string, r) =>
        isRowInEdit(r) && editing ? (
          <InputNumber size="small" min={0} step={0.01} decimalSeparator="," style={{ width: '100%' }} value={editing.unitPrice} onChange={(val) => setEditing({ ...editing, unitPrice: Number(val ?? 0) })} onPressEnter={commit} />
        ) : formatMoney(v),
    },
    { title: 'Сумма', dataIndex: 'total', width: 105, align: 'right', render: (v: string, r) =>
        isRowInEdit(r) && editing ? <strong>{formatMoney(editing.quantity * editing.unitPrice)}</strong> : <strong>{formatMoney(v)}</strong>,
    },
    ...(editable && !deleteMode
      ? [{
          title: '', width: 64,
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
              </Space>
            );
          },
        }]
      : []),
  ];

  const contractorOptions = orgs
    ?.filter((o) => o.type === 'subcontractor' || o.type === 'general_contractor')
    .map((o) => ({ value: o.id, label: o.name }));

  return (
    <div
      className={isActiveType ? 'estimat-group-active' : undefined}
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
            placeholder="Подрядчик"
            style={{ minWidth: 200 }}
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

        <span style={{ flex: 1 }} />
        <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(groupTotal)}</span>
        {editable && !deleteMode && (
          <Button type="primary" size="small" icon={<PlusOutlined />} disabled={!!editing} onClick={() => setEditing({ workId: null, rateId: null, description: '', unit: '', quantity: 1, unitPrice: 0, originalDescription: '', originalRateId: null })}>
            Работа
          </Button>
        )}
      </div>

      {!(collapsible && collapsed) && (
        <Table
          rowKey="id"
          size="small"
          className="estimat-compact"
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
                    setExpandedKeys((keys) => (keys.includes(r.id) ? keys : [...keys, r.id]));
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
          expandable={{
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) => setExpandedKeys(keys),
            rowExpandable: (r) => r.id !== DRAFT_ID,
            expandedRowRender: (r) => (
              <MaterialsSubTable
                work={r}
                editable={editable}
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
            ),
          }}
        />
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
