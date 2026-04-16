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

interface DraftState {
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
  rateId?: string;
  materialId?: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

interface Props {
  section: EstimateSection;
  index: number;
  editable: boolean;
  onSaveItem: (sectionId: string, payload: SaveItemPayload) => Promise<void>;
  onDeleteItem: (itemId: string) => void;
  onDeleteSection: (sectionId: string) => void;
}

const EMPTY_DRAFT: DraftState = {
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
  onSaveItem,
  onDeleteItem,
  onDeleteSection,
}: Props) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: ratesData } = useQuery({
    queryKey: ['rates'],
    queryFn: () => api.get<{ data: Rate[] }>('/rates'),
    enabled: !!draft && draft.itemType === 'work',
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get<{ data: Material[] }>('/materials'),
    enabled: !!draft && draft.itemType === 'material',
  });

  const sectionTotal = section.items.reduce(
    (acc, it) => acc + Number(it.total ?? 0),
    0,
  );

  const draftRow: EstimateItem | null = draft
    ? {
        id: DRAFT_ID,
        section_id: section.id,
        item_type: draft.itemType,
        rate_id: draft.rateId,
        material_id: draft.materialId,
        description: draft.description,
        quantity: String(draft.quantity),
        unit: draft.unit,
        unit_price: String(draft.unitPrice),
        total: String(draft.quantity * draft.unitPrice),
        sort_order: 9999,
        rate_name: null,
        rate_code: null,
        material_name: null,
      }
    : null;

  const dataSource: EstimateItem[] = draftRow
    ? [...section.items, draftRow]
    : section.items;

  const nameOptions =
    draft?.itemType === 'work'
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
    if (!draft) return;
    if (draft.itemType === 'work') {
      const rate = ratesData?.data.find((r) => r.id === id);
      if (rate) {
        setDraft({
          ...draft,
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
        setDraft({
          ...draft,
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
    if (!draft) return;
    setDraft({
      ...draft,
      itemType: type,
      rateId: null,
      materialId: null,
    });
  }

  function handleAddDraft() {
    if (draft) return;
    setDraft({ ...EMPTY_DRAFT });
  }

  function handleCancel() {
    setDraft(null);
  }

  async function handleCommit() {
    if (!draft || saving) return;
    const description = draft.description.trim();
    const unit = draft.unit.trim();
    if (!description) {
      message.warning('Укажите наименование');
      return;
    }
    if (!unit) {
      message.warning('Укажите единицу измерения');
      return;
    }
    if (!(draft.quantity > 0)) {
      message.warning('Количество должно быть больше 0');
      return;
    }
    if (draft.unitPrice < 0) {
      message.warning('Цена не может быть отрицательной');
      return;
    }

    setSaving(true);
    try {
      await onSaveItem(section.id, {
        itemType: draft.itemType,
        rateId: draft.rateId ?? undefined,
        materialId: draft.materialId ?? undefined,
        description,
        unit,
        quantity: draft.quantity,
        unitPrice: draft.unitPrice,
      });
      setDraft(null);
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
      width: 120,
      render: (_v, r) => {
        if (r.id === DRAFT_ID && draft) {
          return (
            <Segmented
              size="small"
              value={draft.itemType}
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
        if (r.id === DRAFT_ID && draft) {
          return (
            <AutoComplete
              style={{ width: '100%' }}
              value={draft.description}
              options={nameOptions}
              onChange={(text) =>
                setDraft({ ...draft, description: text ?? '' })
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
                draft.itemType === 'work'
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
        if (r.id === DRAFT_ID && draft) {
          return (
            <Input
              size="small"
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
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
        if (r.id === DRAFT_ID && draft) {
          return (
            <InputNumber
              size="small"
              min={0}
              step={0.01}
              decimalSeparator=","
              style={{ width: '100%' }}
              value={draft.quantity}
              onChange={(val) =>
                setDraft({ ...draft, quantity: Number(val ?? 0) })
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
        if (r.id === DRAFT_ID && draft) {
          return (
            <InputNumber
              size="small"
              min={0}
              step={0.01}
              decimalSeparator=","
              style={{ width: '100%' }}
              value={draft.unitPrice}
              onChange={(val) =>
                setDraft({ ...draft, unitPrice: Number(val ?? 0) })
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
        if (r.id === DRAFT_ID && draft) {
          return (
            <strong>{formatMoney(draft.quantity * draft.unitPrice)}</strong>
          );
        }
        return <strong>{formatMoney(v)}</strong>;
      },
    },
    ...(editable
      ? [
          {
            title: '',
            width: 80,
            render: (_: unknown, r: EstimateItem) => {
              if (r.id === DRAFT_ID) {
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
                <Popconfirm
                  title="Удалить позицию?"
                  onConfirm={() => onDeleteItem(r.id)}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>
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
        if (e.key === 'Escape' && draft && !saving) {
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
              disabled={!!draft}
            >
              Позиция
            </Button>
            <Popconfirm
              title="Удалить раздел со всеми позициями?"
              onConfirm={() => onDeleteSection(section.id)}
            >
              <Button
                type="text"
                size="small"
                danger
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
        dataSource={dataSource}
        pagination={false}
        locale={{ emptyText: 'Нет позиций. Нажмите «Позиция».' }}
      />
    </div>
  );
}
