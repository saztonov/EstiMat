/**
 * Фабрика колонок таблицы материалов. ЧИСТАЯ функция без хуков: вызывается внутри
 * существующего useMemo в MaterialsSubTable с прежним deps-массивом, ctx-объект
 * строится внутри колбэка useMemo — частота пересборки колонок не меняется.
 * Не объявлять компоненты внутри — только render-функции (иначе размонтирование
 * ячеек и потеря фокуса AutoComplete при пересборке).
 */
import type { Dispatch, SetStateAction, ReactNode } from 'react';
import { Button, Popconfirm, Space, Tag, AutoComplete, InputNumber, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, CheckOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';
import { UnitSelect } from '../../../components/UnitSelect';
import type { EstimateMaterial, MaterialEdit } from './types';
import { formatMoney } from './types';

export interface MaterialsColumnsCtx {
  editing: MaterialEdit | null;
  setEditing: Dispatch<SetStateAction<MaterialEdit | null>>;
  saving: boolean;
  /** Объём работы — база пересчёта кол-ва по коэффициенту расхода. */
  workQty: number;
  nameOptions: Array<{ key: string; value: string; label: string }> | undefined;
  editable: boolean;
  deleteMode: boolean;
  showPrices: boolean;
  isRowInEdit: (r: EstimateMaterial) => boolean;
  selectRef: (id: string) => void;
  commit: () => void;
  reassignBtn: (r: EstimateMaterial) => ReactNode;
  onConfirm: (materialId: string) => void;
  onDelete: (materialId: string) => void;
}

export function buildMaterialsColumns(ctx: MaterialsColumnsCtx): ColumnsType<EstimateMaterial> {
  const {
    editing, setEditing, saving, workQty, nameOptions,
    editable, deleteMode, showPrices,
    isRowInEdit, selectRef, commit, reassignBtn, onConfirm, onDelete,
  } = ctx;
  return [
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
  ];
}
