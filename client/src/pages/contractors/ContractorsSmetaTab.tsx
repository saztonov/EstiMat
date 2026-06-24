import { useMemo, useState } from 'react';
import { Table, Tag, Space, Select, InputNumber, Button, Checkbox, Empty, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Organization } from '@estimat/shared';
import { api, apiFetch } from '../../services/api';
import {
  buildCostTypeGroups,
  formatMoney,
  type EstimateItem,
  type ItemContractor,
} from '../estimates/components/types';
import { formatLocationLabel } from '../estimates/components/location';

type AssignMode = 'remainder' | 'percent' | 'qty';

interface Props {
  estimateId: string;
  items: EstimateItem[];
  /** Инженер/админ — может назначать; подрядчик — только просмотр своих строк. */
  canAssign: boolean;
  viewerIsContractor: boolean;
  onChanged: () => void;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

// Тег подрядчика строки с его объёмом/долей.
function contractorTag(c: ItemContractor) {
  const label = c.assigned_percent != null
    ? `${c.contractor_name ?? '—'} · ${num(c.assigned_percent)}%`
    : c.assigned_qty != null
      ? `${c.contractor_name ?? '—'} · ${num(c.assigned_qty)}`
      : `${c.contractor_name ?? '—'} · весь объём`;
  return <Tag color="purple" key={c.contractor_id}>{label}</Tag>;
}

export function ContractorsSmetaTab({ estimateId, items, canAssign, viewerIsContractor, onChanged }: Props) {
  const { message } = App.useApp();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [contractorId, setContractorId] = useState<string | undefined>();
  const [mode, setMode] = useState<AssignMode>('remainder');
  const [percent, setPercent] = useState<number>(100);
  const [qty, setQty] = useState<number>(0);

  // Организации-подрядчики для назначения (только инженеру).
  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Organization[] }>('/organizations'),
    enabled: canAssign,
  });
  const contractorOptions = useMemo(
    () =>
      (orgsData?.data ?? [])
        .filter((o) => o.type === 'subcontractor' || o.type === 'general_contractor')
        .map((o) => ({ value: o.id, label: o.name })),
    [orgsData],
  );

  const visibleItems = useMemo(
    () => (onlyUnassigned ? items.filter((it) => num(it.remaining_qty ?? it.quantity) > 1e-6) : items),
    [items, onlyUnassigned],
  );
  const groups = useMemo(() => buildCostTypeGroups(visibleItems, []), [visibleItems]);

  const selectedIds = useMemo(() => [...selected], [selected]);

  const assignMutation = useMutation({
    mutationFn: () => {
      if (!contractorId) throw new Error('Выберите подрядчика');
      type AssignResult = { data?: { assigned?: number } };
      if (mode === 'remainder') {
        return api.post<AssignResult>('/contractors/assignments', { mode: 'remainder', contractorId, itemIds: selectedIds });
      }
      if (mode === 'percent') {
        return api.post<AssignResult>('/contractors/assignments', { mode: 'percent', contractorId, itemIds: selectedIds, percent });
      }
      // qty — абсолютный объём допустим только для одной строки за раз
      return api.post<AssignResult>('/contractors/assignments', {
        mode: 'qty',
        contractorId,
        assignments: selectedIds.map((id) => ({ itemId: id, assignedQty: qty })),
      });
    },
    onSuccess: (res) => {
      message.success(`Назначено строк: ${res?.data?.assigned ?? selectedIds.length}`);
      setSelected(new Set());
      onChanged();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: () =>
      apiFetch('/contractors/assignments', {
        method: 'DELETE',
        body: JSON.stringify({ itemIds: selectedIds }),
      }),
    onSuccess: () => {
      message.success('Подрядчики сняты с выбранных строк');
      setSelected(new Set());
      onChanged();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const selectWholeGroup = (works: EstimateItem[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      works.forEach((w) => next.add(w.id));
      return next;
    });
  };

  const columns: ColumnsType<EstimateItem> = [
    {
      title: 'Локация',
      key: 'location',
      width: 200,
      render: (_, it) => formatLocationLabel(it) || <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: 'Работа',
      dataIndex: 'description',
      key: 'description',
      render: (_, it) => (
        <span>
          {it.description}
          {it.rate_name && it.rate_name !== it.description && (
            <span style={{ color: '#8c8c8c' }}> · {it.rate_name}</span>
          )}
        </span>
      ),
    },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'quantity', width: 90, align: 'right', render: (v) => num(v) },
  ];

  if (viewerIsContractor) {
    columns.push({
      title: 'Мой объём',
      key: 'my',
      width: 120,
      align: 'right',
      render: (_, it) => num(it.my_effective_qty),
    });
  } else {
    columns.push(
      {
        title: 'Подрядчики',
        key: 'contractors',
        render: (_, it) =>
          it.item_contractors && it.item_contractors.length > 0 ? (
            <Space size={4} wrap>
              {it.item_contractors.map(contractorTag)}
            </Space>
          ) : (
            <Tag>без подрядчика</Tag>
          ),
      },
      {
        title: 'Остаток',
        key: 'remaining',
        width: 110,
        align: 'right',
        render: (_, it) => {
          if (it.over_assigned) return <Tag color="red">превышение</Tag>;
          const rem = num(it.remaining_qty ?? it.quantity);
          return rem > 1e-6 ? <Tag color="orange">{rem}</Tag> : <Tag color="green">распределено</Tag>;
        },
      },
    );
  }

  if (groups.length === 0) {
    return <Empty description="Строк нет" />;
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {!viewerIsContractor && (
        <Space wrap>
          <Checkbox checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)}>
            Только с нераспределённым объёмом
          </Checkbox>
        </Space>
      )}

      {canAssign && selected.size > 0 && (
        <Space wrap style={{ padding: 8, background: '#fafafa', borderRadius: 6 }}>
          <span>Выбрано строк: {selected.size}</span>
          <Select
            placeholder="Подрядчик"
            style={{ width: 220 }}
            value={contractorId}
            onChange={setContractorId}
            options={contractorOptions}
            showSearch
            optionFilterProp="label"
          />
          <Select
            style={{ width: 160 }}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'remainder', label: 'Весь остаток' },
              { value: 'percent', label: 'Процент' },
              { value: 'qty', label: 'Объём (1 строка)' },
            ]}
          />
          {mode === 'percent' && (
            <InputNumber min={0.01} max={100} value={percent} onChange={(v) => setPercent(v ?? 0)} addonAfter="%" />
          )}
          {mode === 'qty' && (
            <InputNumber
              min={0.01}
              value={qty}
              onChange={(v) => setQty(v ?? 0)}
              disabled={selected.size !== 1}
              placeholder="Объём"
            />
          )}
          <Button type="primary" loading={assignMutation.isPending} onClick={() => assignMutation.mutate()}>
            Назначить
          </Button>
          <Button danger loading={clearMutation.isPending} onClick={() => clearMutation.mutate()}>
            Снять
          </Button>
          <Button type="text" onClick={() => setSelected(new Set())}>
            Сбросить
          </Button>
        </Space>
      )}

      {groups.map((g) => (
        <div key={g.costTypeId ?? '__none__'}>
          <Space style={{ marginBottom: 8 }}>
            <strong>
              {g.costCategoryName ? `${g.costCategoryName} · ` : ''}
              {g.costTypeName ?? 'Без вида работ'}
            </strong>
            {canAssign && (
              <Button size="small" type="link" onClick={() => selectWholeGroup(g.works)}>
                выделить весь вид
              </Button>
            )}
          </Space>
          <Table<EstimateItem>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={g.works}
            columns={columns}
            rowSelection={
              canAssign
                ? {
                    selectedRowKeys: g.works.filter((w) => selected.has(w.id)).map((w) => w.id),
                    onSelect: (record, on) => toggle(record.id, on),
                    onSelectAll: (on, _sel, changed) => changed.forEach((r) => toggle(r.id, on)),
                  }
                : undefined
            }
          />
        </div>
      ))}
    </Space>
  );
}
