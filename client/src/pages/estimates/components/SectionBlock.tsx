import { useState } from 'react';
import {
  Table,
  Button,
  Popconfirm,
  Space,
  Tag,
  Segmented,
  AutoComplete,
  Input,
  InputNumber,
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
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import type { EstimateSection, EstimateItem } from './types';
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

interface EditingState {
  itemId: string | null;
  itemType: 'work' | 'material';
  rateId: string | null;
  materialId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

export interface SaveItemPayload {
  itemType: 'work' | 'material';
  rateId?: string | null;
  materialId?: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

interface Props {
  section: EstimateSection;
  index: number;
  editable: boolean;
  onCreateItem: (sectionId: string, payload: SaveItemPayload) => Promise<void>;
  onUpdateItem: (itemId: string, payload: SaveItemPayload) => Promise<void>;
  onDeleteItem: (itemId: string) => void;
  onEditSection: (sectionId: string) => void;
  onDeleteSection: (sectionId: string) => void;
}

const EMPTY_EDIT: EditingState = {
  itemId: null,
  itemType: 'work',
  rateId: null,
  materialId: null,
  description: '',
  unit: '',
  quantity: 1,
  unitPrice: 0,
};

export function SectionBlock({
  section,
  index,
  editable,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onEditSection,
  onDeleteSection,
}: Props) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: ratesData } = useQuery({
    queryKey: ['rates', section.cost_type_id],
    queryFn: () =>
      api.get<{ data: Rate[] }>(
        `/rates?costTypeId=${encodeURIComponent(section.cost_type_id ?? '')}`,
      ),
    enabled: !!editing && editing.itemType === 'work' && !!section.cost_type_id,
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get<{ data: Material[] }>('/materials'),
    enabled: !!editing && editing.itemType === 'material',
  });

  const sectionTotal = section.items.reduce(
    (acc, it) => acc + Number(it.total ?? 0),
    0,
  );

  const isEditingExisting = !!editing && editing.itemId !== null;
  const isAddingDraft = !!editing && editing.itemId === null;

  // Собираем строки таблицы: для редактируемой существующей — подменяем её,
  // для draft — добавляем в конец.
  const rowsForTable: EstimateItem[] = section.items.map((it) =>
    editing && editing.itemId === it.id
      ? {
          ...it,
          item_type: editing.itemType,
          rate_id: editing.rateId,
          material_id: editing.materialId,
          description: editing.description,
          unit: editing.unit,
          quantity: String(editing.quantity),
          unit_price: String(editing.unitPrice),
          total: String(editing.quantity * editing.unitPrice),
        }
      : it,
  );
  if (isAddingDraft && editing) {
    rowsForTable.push({
      id: DRAFT_ID,
      section_id: section.id,
      item_type: editing.itemType,
      rate_id: editing.rateId,
      material_id: editing.materialId,
      description: editing.description,
      quantity: String(editing.quantity),
      unit: editing.unit,
      unit_price: String(editing.unitPrice),
      total: String(editing.quantity * editing.unitPrice),
      sort_order: 9999,
      rate_name: null,
      rate_code: null,
      material_name: null,
    });
  }

  const isRowInEdit = (r: EstimateItem) =>
    !!editing && (r.id === DRAFT_ID || r.id === editing.itemId);

  const nameOptions =
    editing?.itemType === 'work'
      ? ratesData?.data.map((r) => ({
          key: r.id,
          value: r.code ? `[${r.code}] ${r.name}` : r.name,
          label: `${r.code ? `[${r.code}] ` : ''}${r.name} · ${r.unit} · ${Number(r.price).toLocaleString('ru-RU')} ₽`,
        }))
      : materialsData?.data.map((m) => ({
          key: m.id,
          value: m.name,
          label: `${m.name} · ${m.unit} · ${Number(m.unit_price ?? 0).toLocaleString('ru-RU')} ₽`,
        }));

  function handleSelectRef(id: string) {
    if (!editing) return;
    if (editing.itemType === 'work') {
      const rate = ratesData?.data.find((r) => r.id === id);
      if (rate) {
        setEditing({
          ...editing,
          rateId: rate.id,
          materialId: null,
          description: rate.code ? `[${rate.code}] ${rate.name}` : rate.name,
          unit: rate.unit,
          unitPrice: Number(rate.price),
        });
      }
    } else {
      const mat = materialsData?.data.find((m) => m.id === id);
      if (mat) {
        setEditing({
          ...editing,
          materialId: mat.id,
          rateId: null,
          description: mat.name,
          unit: mat.unit,
          unitPrice: Number(mat.unit_price ?? 0),
        });
      }
    }
  }

  function handleTypeChange(type: 'work' | 'material') {
    if (!editing) return;
    setEditing({
      ...editing,
      itemType: type,
      rateId: null,
      materialId: null,
    });
  }

  function handleAddDraft() {
    if (editing) return;
    setEditing({ ...EMPTY_EDIT });
  }

  function handleEditItem(item: EstimateItem) {
    if (editing) return;
    setEditing({
      itemId: item.id,
      itemType: item.item_type,
      rateId: item.rate_id,
      materialId: item.material_id,
      description: item.description,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
    });
  }

  function handleCancel() {
    setEditing(null);
  }

  async function handleCommit() {
    if (!editing || saving) return;
    const description = editing.description.trim();
    const unit = editing.unit.trim();
    if (!description) {
      message.warning('Укажите наименование');
      return;
    }
    if (!unit) {
      message.warning('Укажите единицу измерения');
      return;
    }
    if (!(editing.quantity > 0)) {
      message.warning('Количество должно быть больше 0');
      return;
    }
    if (editing.unitPrice < 0) {
      message.warning('Цена не может быть отрицательной');
      return;
    }

    const payload: SaveItemPayload = {
      itemType: editing.itemType,
      rateId: editing.rateId,
      materialId: editing.materialId,
      description,
      unit,
      quantity: editing.quantity,
      unitPrice: editing.unitPrice,
    };

    setSaving(true);
    try {
      if (editing.itemId) {
        await onUpdateItem(editing.itemId, payload);
      } else {
        await onCreateItem(section.id, payload);
      }
      setEditing(null);
    } catch {
      // ошибку покажет мутация в родителе
    } finally {
      setSaving(false);
    }
  }

  const columns: ColumnsType<EstimateItem> = [
    {
      title: '№',
      width: 50,
      render: (_v, r, i) => (r.id === DRAFT_ID ? '—' : i + 1),
    },
    {
      title: 'Тип',
      width: 130,
      render: (_v, r) => {
        if (isRowInEdit(r) && editing) {
          return (
            <Segmented
              size="small"
              value={editing.itemType}
              onChange={(v) => handleTypeChange(v as 'work' | 'material')}
              options={[
                { label: 'Работа', value: 'work' },
                { label: 'Материал', value: 'material' },
              ]}
            />
          );
        }
        return r.item_type === 'material' ? (
          <Tag color="blue">Материал</Tag>
        ) : (
          <Tag color="green">Работа</Tag>
        );
      },
    },
    {
      title: 'Наименование',
      dataIndex: 'description',
      render: (v: string, r: EstimateItem) => {
        if (isRowInEdit(r) && editing) {
          return (
            <AutoComplete
              style={{ width: '100%' }}
              value={editing.description}
              options={nameOptions}
              onChange={(text) =>
                setEditing({ ...editing, description: text ?? '' })
              }
              onSelect={(_val, option) => {
                const id = (option as { key?: string }).key;
                if (id) handleSelectRef(id);
              }}
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              placeholder={
                editing.itemType === 'work'
                  ? 'Наименование работы или выбор из справочника'
                  : 'Наименование материала или выбор из справочника'
              }
              autoFocus
            />
          );
        }
        return v;
      },
    },
    {
      title: 'Ед. изм.',
      dataIndex: 'unit',
      width: 110,
      align: 'center',
      render: (v: string, r: EstimateItem) => {
        if (isRowInEdit(r) && editing) {
          return (
            <Input
              size="small"
              value={editing.unit}
              onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
              onPressEnter={handleCommit}
            />
          );
        }
        return v;
      },
    },
    {
      title: 'Кол-во',
      dataIndex: 'quantity',
      width: 120,
      align: 'right',
      render: (v: string, r: EstimateItem) => {
        if (isRowInEdit(r) && editing) {
          return (
            <InputNumber
              size="small"
              min={0}
              step={0.01}
              decimalSeparator=","
              style={{ width: '100%' }}
              value={editing.quantity}
              onChange={(val) =>
                setEditing({ ...editing, quantity: Number(val ?? 0) })
              }
              onPressEnter={handleCommit}
            />
          );
        }
        return Number(v).toLocaleString('ru-RU');
      },
    },
    {
      title: 'Цена',
      dataIndex: 'unit_price',
      width: 140,
      align: 'right',
      render: (v: string, r: EstimateItem) => {
        if (isRowInEdit(r) && editing) {
          return (
            <InputNumber
              size="small"
              min={0}
              step={0.01}
              decimalSeparator=","
              style={{ width: '100%' }}
              value={editing.unitPrice}
              onChange={(val) =>
                setEditing({ ...editing, unitPrice: Number(val ?? 0) })
              }
              onPressEnter={handleCommit}
            />
          );
        }
        return formatMoney(v);
      },
    },
    {
      title: 'Сумма',
      dataIndex: 'total',
      width: 150,
      align: 'right',
      render: (v: string, r: EstimateItem) => {
        if (isRowInEdit(r) && editing) {
          return (
            <strong>
              {formatMoney(editing.quantity * editing.unitPrice)}
            </strong>
          );
        }
        return <strong>{formatMoney(v)}</strong>;
      },
    },
    ...(editable
      ? [
          {
            title: '',
            width: 90,
            render: (_: unknown, r: EstimateItem) => {
              if (isRowInEdit(r)) {
                return (
                  <Space size={4}>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CheckOutlined />}
                      loading={saving}
                      onClick={handleCommit}
                    />
                    <Button
                      size="small"
                      icon={<CloseOutlined />}
                      disabled={saving}
                      onClick={handleCancel}
                    />
                  </Space>
                );
              }
              return (
                <Space size={4}>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    disabled={!!editing}
                    onClick={() => handleEditItem(r)}
                  />
                  <Popconfirm
                    title="Удалить позицию?"
                    onConfirm={() => onDeleteItem(r.id)}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      disabled={!!editing}
                      icon={<DeleteOutlined />}
                    />
                  </Popconfirm>
                </Space>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 8,
        marginBottom: 16,
        border: '1px solid #f0f0f0',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && editing && !saving) {
          e.stopPropagation();
          handleCancel();
        }
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          background: '#fafbfc',
          borderBottom: '1px solid #f0f0f0',
          gap: 12,
        }}
      >
        <strong style={{ fontSize: 15 }}>
          {index + 1}. {section.name}
        </strong>
        {section.contractor_name && (
          <Tag icon={<UserOutlined />} color="purple">
            {section.contractor_name}
          </Tag>
        )}
        <span style={{ color: '#8c8c8c', flex: 1 }} />
        <span style={{ color: '#1677ff', fontWeight: 600 }}>
          {formatMoney(sectionTotal)}
        </span>
        {editable && (
          <Space>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={handleAddDraft}
              disabled={!!editing}
            >
              Позиция
            </Button>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              disabled={!!editing}
              onClick={() => onEditSection(section.id)}
            />
            <Popconfirm
              title="Удалить раздел со всеми позициями?"
              onConfirm={() => onDeleteSection(section.id)}
            >
              <Button
                type="text"
                size="small"
                danger
                disabled={!!editing}
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          </Space>
        )}
      </div>

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rowsForTable}
        pagination={false}
        locale={{ emptyText: 'Нет позиций. Нажмите «Позиция».' }}
        rowClassName={(r) => (isRowInEdit(r) ? 'estimat-row-editing' : '')}
      />
      {isEditingExisting && <div style={{ display: 'none' }} />}
    </div>
  );
}
