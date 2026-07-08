import { useMemo, useState } from 'react';
import { Table, Tag, Space, Empty, Tooltip, Select, Button, InputNumber, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { buildMaterialGroups, type AggregatedMaterial } from '../estimates/materials/aggregateMaterials';
import { formatMoney, type EstimateItem } from '../estimates/components/types';

interface Props {
  estimateId: string;
  items: EstimateItem[];
  /** Подрядчик: материалы масштабируются по его доле строки (effective_qty / quantity). */
  viewerIsContractor: boolean;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const EPS = 1e-6;

// Ключ строки заказа/заявки: (вид работ, свёртка материала). agg_key = m.key из свода.
const rowKey = (costTypeId: string | null, aggKey: string) => `${costTypeId ?? ''}|${aggKey}`;

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

export function ContractorsMaterialsTab({ estimateId, items, viewerIsContractor }: Props) {
  const [filterContractorIds, setFilterContractorIds] = useState<string[]>([]);
  // Режим заявки на материалы (только подрядчик).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Map<string, number>>(new Map());
  const { message } = App.useApp();
  const queryClient = useQueryClient();

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

  // Заказано ранее: подрядчику — по своей организации; сотруднику — по фильтру/суммарно.
  const orderedQ = useQuery({
    queryKey: ['material-ordered', estimateId, viewerIsContractor ? 'me' : filterContractorIds.join(',')],
    queryFn: () => {
      const params = new URLSearchParams({ estimateId });
      if (!viewerIsContractor && filterContractorIds.length)
        params.set('contractorIds', filterContractorIds.join(','));
      return api.get<{ data: { cost_type_id: string | null; agg_key: string; ordered_qty: string }[] }>(
        `/material-requests/ordered?${params.toString()}`,
      );
    },
    enabled: !!estimateId,
  });

  const orderedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of orderedQ.data?.data ?? []) m.set(rowKey(r.cost_type_id, r.agg_key), num(r.ordered_qty));
    return m;
  }, [orderedQ.data]);

  const submitMutation = useMutation({
    mutationFn: (lines: unknown[]) => api.post('/material-requests', { estimateId, lines }),
    onSuccess: () => {
      message.success('Заявка отправлена');
      setEditing(false);
      setDraft(new Map());
      queryClient.invalidateQueries({ queryKey: ['material-ordered', estimateId] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  function updateDraft(key: string, v: number | null) {
    setDraft((prev) => {
      const next = new Map(prev);
      if (v == null || v <= 0) next.delete(key);
      else next.set(key, v);
      return next;
    });
  }

  function cancelEditing() {
    setEditing(false);
    setDraft(new Map());
  }

  function submit() {
    const lines: {
      costTypeId: string | null;
      aggKey: string;
      materialId: string | null;
      name: string;
      unit: string;
      quantity: number;
    }[] = [];
    for (const g of groups)
      for (const m of g.materials) {
        const q = draft.get(rowKey(g.costTypeId, m.key));
        if (q && q > 0)
          lines.push({
            costTypeId: g.costTypeId,
            aggKey: m.key,
            materialId: m.materialId,
            name: m.name,
            unit: m.unit,
            quantity: q,
          });
      }
    if (lines.length === 0) {
      message.warning('Укажите количество хотя бы для одного материала');
      return;
    }
    submitMutation.mutate(lines);
  }

  // Колонки строятся на группу (нужен costTypeId группы для ключа заказа/заявки).
  function buildColumns(costTypeId: string | null): ColumnsType<AggregatedMaterial> {
    const cols: ColumnsType<AggregatedMaterial> = [
      {
        title: 'Материал',
        dataIndex: 'name',
        key: 'name',
        render: (_, m) => {
          const key = rowKey(costTypeId, m.key);
          const ordered = orderedMap.get(key) ?? 0;
          const req = draft.get(key) ?? 0;
          const over = viewerIsContractor ? ordered + req > m.quantity + EPS : ordered > m.quantity + EPS;
          return (
            <Space size={4}>
              {m.name}
              {m.hasSuggested && <Tag color="orange">предложение</Tag>}
              {m.hasAi && <Tag color="blue">ИИ</Tag>}
              {over && <Tag color="red">Сверх сметы</Tag>}
            </Space>
          );
        },
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
      {
        title: 'Заказано',
        key: 'ordered',
        width: 100,
        align: 'right',
        render: (_, m) => {
          const v = orderedMap.get(rowKey(costTypeId, m.key)) ?? 0;
          return v > 0 ? Math.round(v * 1e4) / 1e4 : <span style={{ color: '#bfbfbf' }}>—</span>;
        },
      },
    ];

    // Колонка «Заявка» — только в режиме заявки (подрядчик).
    if (editing && viewerIsContractor) {
      cols.push({
        title: 'Заявка',
        key: 'request',
        width: 120,
        align: 'right',
        render: (_, m) => {
          const key = rowKey(costTypeId, m.key);
          return (
            <InputNumber
              min={0}
              style={{ width: 100 }}
              value={draft.get(key)}
              onChange={(v) => updateDraft(key, v as number | null)}
            />
          );
        },
      });
    }

    cols.push({
      title: <Tooltip title="Поставки — следующая итерация">Поставлено</Tooltip>,
      key: 'delivered',
      width: 100,
      align: 'right',
      render: () => <span style={{ color: '#bfbfbf' }}>—</span>,
    });

    return cols;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!viewerIsContractor && (
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
        )}
        {viewerIsContractor &&
          (editing ? (
            <>
              <Button type="primary" loading={submitMutation.isPending} onClick={submit}>
                Подтвердить
              </Button>
              <Button onClick={cancelEditing}>Отмена</Button>
            </>
          ) : (
            <Button icon={<PlusOutlined />} onClick={() => setEditing(true)}>
              Заявка на материалы
            </Button>
          ))}
      </div>
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
                columns={buildColumns(g.costTypeId)}
                scroll={{ x: 860 }}
              />
            </div>
          ))}
          </Space>
        )}
      </div>
    </div>
  );
}
