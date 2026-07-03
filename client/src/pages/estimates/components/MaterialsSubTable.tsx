import { memo, useEffect, useMemo, useRef, useState, type Key, type RefObject } from 'react';
import {
  Table,
  Button,
  Popconfirm,
  Popover,
  Space,
  Tag,
  AutoComplete,
  InputNumber,
  Tooltip,
  App,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../../services/api';
import { UnitSelect } from '../../../components/UnitSelect';
import { WorkTreeSelect, type WorkOption } from './WorkTreeSelect';
import type { EstimateItem, EstimateMaterial, SaveMaterialPayload, MaterialEdit } from './types';
import { formatMoney, DRAFT_ID } from './types';

interface Material {
  id: string;
  name: string;
  unit: string;
  unit_price: string;
}

export interface MaterialsSubTableProps {
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
}: MaterialsSubTableProps) {
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

  // Объём работы — база для пересчёта количества материала с коэф-том.
  const workQty = Number(work.quantity);

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
            qty_ratio: editing.qtyRatio != null ? String(editing.qtyRatio) : null,
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
        qty_ratio: editing.qtyRatio != null ? String(editing.qtyRatio) : null,
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
      qtyRatio: editing.qtyRatio,
      expectedVersion: editing.expectedVersion,
    };
    setSaving(true);
    try {
      if (editing.materialId) await onUpdate(editing.materialId, payload);
      else await onCreate(work.id, payload);
      setEditing(null);
    } catch (e) {
      // OCC-конфликт: материал изменил другой пользователь. Форму не закрываем, обновляем
      // version из ответа — повторное «сохранить» осознанно ляжет поверх (см. doSave работ).
      if (e instanceof ApiError && e.status === 409) {
        const v = (e.data as { version?: number } | undefined)?.version;
        if (typeof v === 'number') setEditing((prev) => (prev ? { ...prev, expectedVersion: v } : prev));
      }
      /* прочие ошибки покажет мутация */
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
    { title: 'Коэф.', dataIndex: 'qty_ratio', width: 76, align: 'center',
      // Коэффициент расхода: задан → кол-во = коэф × объём работы (поле кол-ва блокируется);
      // пусто → ручной ввод количества.
      render: (v: string | null, r) =>
        isRowInEdit(r) && editing ? (
          <InputNumber
            size="small"
            min={0}
            step={0.01}
            decimalSeparator=","
            placeholder="—"
            style={{ width: '100%' }}
            value={editing.qtyRatio ?? undefined}
            onChange={(val) => {
              const ratio = val == null || Number(val) <= 0 ? null : Number(val);
              setEditing({
                ...editing,
                qtyRatio: ratio,
                // При заданном коэф-те кол-во вычисляется сразу (для отображения суммы);
                // сервер пересчитает авторитетно. При очистке кол-во остаётся прежним (ручной ввод).
                quantity: ratio != null ? ratio * workQty : editing.quantity,
              });
            }}
            onPressEnter={commit}
          />
        ) : v != null ? Number(v).toLocaleString('ru-RU') : '—',
    },
    { title: 'Кол-во', dataIndex: 'quantity', width: 76, align: 'center', render: (v: string, r) =>
        isRowInEdit(r) && editing ? (
          <InputNumber size="small" min={0} step={0.01} decimalSeparator="," style={{ width: '100%' }} value={editing.quantity} disabled={editing.qtyRatio != null} onChange={(val) => setEditing({ ...editing, quantity: Number(val ?? 0) })} onPressEnter={commit} />
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
                  onClick={() => setEditing({ materialId: r.id, refMaterialId: r.material_id, description: r.description, unit: r.unit, quantity: Number(r.quantity), unitPrice: Number(r.unit_price), qtyRatio: r.qty_ratio != null ? Number(r.qty_ratio) : null, expectedVersion: r.version })} />
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
    editing, saving, nameOptions, materialsData, editable, deleteMode, showPrices, workQty,
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
          onClick={() => setEditing({ materialId: null, refMaterialId: null, description: '', unit: '', quantity: 1, unitPrice: 0, qtyRatio: null })}
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
export const MaterialsSubTable = memo(MaterialsSubTableImpl);

// Высота строки в компактной таблице материалов (estimat-compact size="small"); выверена эмпирически.
const MATERIAL_ROW_H = 30;
const MATERIALS_HEADER_H = 36;
const MATERIALS_ADD_H = 28;

// Ленивая обёртка над таблицей материалов: пока раскрытая строка вне видимой области (+overscan),
// рендерим лёгкий placeholder расчётной высоты вместо тяжёлой таблицы. Это убирает фриз при
// массовом «развернуть всё»: монтируются только видимые таблицы материалов. После первого показа
// таблица остаётся смонтированной (повторный скролл к ней мгновенный).
export function LazyMaterialsSubTable({
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
