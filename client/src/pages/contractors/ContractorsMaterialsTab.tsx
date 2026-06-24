import { useMemo, useState } from 'react';
import { Table, Tag, Space, Empty, Tooltip, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { buildMaterialGroups, type AggregatedMaterial } from '../estimates/materials/aggregateMaterials';
import { formatMoney, type EstimateItem } from '../estimates/components/types';

interface Props {
  items: EstimateItem[];
  /** Подрядчик: материалы масштабируются по его доле строки (effective_qty / quantity). */
  viewerIsContractor: boolean;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

// Для подрядчика — масштабировать материалы строки по его доле объёма (нельзя показывать 100%).
function scaleForContractor(items: EstimateItem[]): EstimateItem[] {
  return items.map((it) => {
    const q = num(it.quantity);
    const eff = num(it.my_effective_qty);
    const share = q > 0 ? eff / q : 1;
    if (share >= 1 - 1e-9) return it;
    return {
      ...it,
      materials: it.materials.map((m) => ({
        ...m,
        quantity: String(num(m.quantity) * share),
        total: String(num(m.total) * share),
      })),
    };
  });
}

export function ContractorsMaterialsTab({ items, viewerIsContractor }: Props) {
  const [filterContractorIds, setFilterContractorIds] = useState<string[]>([]);

  // Опции фильтра — только подрядчики, реально назначенные на работы в этой смете
  // (источник — item_contractors, как на вкладке «Смета»).
  const assignedContractorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items)
      for (const c of it.item_contractors ?? [])
        if (!map.has(c.contractor_id)) map.set(c.contractor_id, c.contractor_name ?? '—');
    return [...map]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [items]);

  const groups = useMemo(() => {
    let src = items;
    if (filterContractorIds.length)
      src = src.filter((it) =>
        (it.item_contractors ?? []).some((c) => filterContractorIds.includes(c.contractor_id)),
      );
    if (viewerIsContractor) src = scaleForContractor(src);
    return buildMaterialGroups(src, []);
  }, [items, viewerIsContractor, filterContractorIds]);

  const columns: ColumnsType<AggregatedMaterial> = [
    {
      title: 'Материал',
      dataIndex: 'name',
      key: 'name',
      render: (_, m) => (
        <Space size={4}>
          {m.name}
          {m.hasSuggested && <Tag color="orange">предложение</Tag>}
          {m.hasAi && <Tag color="blue">ИИ</Tag>}
        </Space>
      ),
    },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    {
      title: 'По смете',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 110,
      align: 'right',
      render: (v: number) => Math.round(v * 1e4) / 1e4,
    },
    { title: 'Сумма', dataIndex: 'total', key: 'total', width: 140, align: 'right', render: (v: number) => formatMoney(v) },
    // Колонки-заглушки под следующую итерацию (заказ материалов).
    {
      title: <Tooltip title="Заказ материалов — следующая итерация">Заказано</Tooltip>,
      key: 'ordered',
      width: 100,
      align: 'right',
      render: () => <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: <Tooltip title="Поставки — следующая итерация">Поставлено</Tooltip>,
      key: 'delivered',
      width: 100,
      align: 'right',
      render: () => <span style={{ color: '#bfbfbf' }}>—</span>,
    },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!viewerIsContractor && (
        <div style={{ flexShrink: 0, marginBottom: 12 }}>
          <Select
            mode="multiple"
            allowClear
            showSearch
            placeholder="Фильтр по подрядчикам"
            style={{ width: 280 }}
            value={filterContractorIds}
            onChange={setFilterContractorIds}
            options={assignedContractorOptions}
            optionFilterProp="label"
            maxTagCount={1}
          />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {groups.length === 0 ? (
          <Empty description="Материалов нет" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {groups.map((g) => (
            <div key={g.costTypeId ?? '__none__'}>
              <Space style={{ marginBottom: 8 }}>
                <strong>
                  {g.costCategoryName ? `${g.costCategoryName} · ` : ''}
                  {g.costTypeName ?? 'Без вида работ'}
                </strong>
                <span style={{ color: '#1677ff' }}>{formatMoney(g.total)}</span>
              </Space>
              <Table<AggregatedMaterial>
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={g.materials}
                columns={columns}
              />
            </div>
          ))}
          </Space>
        )}
      </div>
    </div>
  );
}
