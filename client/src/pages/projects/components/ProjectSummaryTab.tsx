import { useMemo, useState } from 'react';
import { Spin, Card, Empty, Select, Space, App } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { SummaryEstimateBlock, type SummaryEstimate } from './SummaryEstimateBlock';
import { formatMoney } from '../../estimates/components/types';
import type { EstimateItem } from '../../estimates/components/types';

interface SummaryData {
  project: Record<string, unknown>;
  estimates: SummaryEstimate[];
  grandTotal: number;
}

interface Props {
  projectId: string;
}

// Сумма по набору позиций (работы + их материалы) — как в CostTypeGroupBlock.
const itemsTotal = (items: EstimateItem[]) =>
  items.reduce(
    (acc, w) =>
      acc + Number(w.total ?? 0) + (w.materials ?? []).reduce((a, m) => a + Number(m.total ?? 0), 0),
    0,
  );

export function ProjectSummaryTab({ projectId }: Props) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['project-summary', projectId],
    queryFn: () => api.get<{ data: SummaryData }>(`/projects/${projectId}/summary`),
  });

  const deleteMutation = useMutation({
    mutationFn: (estimateId: string) => api.delete(`/estimates/${estimateId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-summary', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects-with-stats'] });
      message.success('Смета удалена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const estimates = data?.data.estimates ?? [];

  // Опции отборов выводим из самих данных свода — показываем только то, что есть.
  const { categoryOptions, typeOptions } = useMemo(() => {
    const cats = new Map<string, string>();
    const types = new Map<string, string>();
    for (const est of estimates) {
      if (est.cost_category_id) cats.set(est.cost_category_id, est.cost_category_name ?? '—');
      for (const it of est.items ?? []) {
        if (it.cost_type_id) types.set(it.cost_type_id, it.cost_type_name ?? '—');
      }
    }
    const toOpts = (m: Map<string, string>) =>
      [...m.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    return { categoryOptions: toOpts(cats), typeOptions: toOpts(types) };
  }, [estimates]);

  // Применяем отборы: категория — на уровне сметы, вид работ — на уровне позиций.
  const filtered = useMemo(() => {
    const out: { est: SummaryEstimate; items: EstimateItem[]; total: number }[] = [];
    for (const est of estimates) {
      if (categoryFilter && est.cost_category_id !== categoryFilter) continue;
      const items = (est.items ?? []).filter((i) => !typeFilter || i.cost_type_id === typeFilter);
      if (typeFilter && items.length === 0) continue;
      out.push({ est, items, total: itemsTotal(items) });
    }
    return out;
  }, [estimates, categoryFilter, typeFilter]);

  if (isLoading) return <Spin />;
  if (!data?.data) return null;

  const grandTotal = filtered.reduce((acc, f) => acc + f.total, 0);
  const count = filtered.length;
  const plural = count === 1 ? 'смета' : count >= 2 && count <= 4 ? 'сметы' : 'смет';

  return (
    <div>
      <Card
        size="small"
        style={{ marginBottom: 16, background: '#e6f4ff', border: '1px solid #91caff' }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 16 }}>Смета по объекту</strong>
          <span style={{ color: '#8c8c8c' }}>
            {count} {plural}
          </span>
          <Space>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Категория"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={categoryOptions}
              style={{ width: 220 }}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Вид работ"
              value={typeFilter}
              onChange={setTypeFilter}
              options={typeOptions}
              style={{ width: 220 }}
            />
          </Space>
          <span style={{ flex: 1 }} />
          <span style={{ color: '#1677ff', fontWeight: 700, fontSize: 18 }}>
            ИТОГО: {formatMoney(grandTotal)}
          </span>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Empty description="Нет смет по заданным отборам" style={{ padding: '40px 0' }} />
      ) : (
        filtered.map((f, i) => (
          <SummaryEstimateBlock
            key={f.est.id}
            estimate={f.est}
            items={f.items}
            total={f.total}
            index={i}
            onDelete={(eid) => deleteMutation.mutate(eid)}
          />
        ))
      )}
    </div>
  );
}
