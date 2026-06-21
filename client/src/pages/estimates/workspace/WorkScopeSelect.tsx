import { Select, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { useWorkScopeStore } from '../../../store/workScopeStore';

interface Props {
  /** Плотная вёрстка для чата: селекторы в ряд + строка-индикатор активной области. */
  compact?: boolean;
}

// Селекторы «область подбора» (разделы/виды работ), общие для режима РД и чата.
// Состояние — в useWorkScopeStore (общее с деревом работ). queryKey/staleTime
// совпадают с РД, чтобы переиспользовать кэш React Query без лишних загрузок.
export function WorkScopeSelect({ compact = false }: Props) {
  const categoryIds = useWorkScopeStore((s) => s.categoryIds);
  const costTypeIds = useWorkScopeStore((s) => s.costTypeIds);
  const setScope = useWorkScopeStore((s) => s.setScope);

  const { data: catsData } = useQuery({
    queryKey: ['rate-categories'],
    queryFn: () => api.get<{ data: { id: string; name: string }[] }>('/rates/categories'),
    staleTime: 5 * 60_000,
  });
  const { data: typesData } = useQuery({
    queryKey: ['rate-types-all'],
    queryFn: () => api.get<{ data: { id: string; name: string; category_id: string }[] }>('/rates/types'),
    staleTime: 5 * 60_000,
  });

  const categoryOptions = (catsData?.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  const typeOptions = (typesData?.data ?? [])
    .filter((t) => categoryIds.length === 0 || categoryIds.includes(t.category_id))
    .map((t) => ({ value: t.id, label: t.name }));

  const categorySelect = (
    <Select
      mode="multiple"
      allowClear
      size="small"
      placeholder="Разделы работ (опционально)"
      style={{ width: '100%', marginBottom: compact ? 0 : 6 }}
      value={categoryIds}
      options={categoryOptions}
      optionFilterProp="label"
      onChange={(vals) => {
        // При смене разделов отбрасываем виды, не входящие в выбранные разделы.
        const allowed = new Set(
          (typesData?.data ?? []).filter((t) => vals.includes(t.category_id)).map((t) => t.id),
        );
        setScope(vals, costTypeIds.filter((id) => allowed.has(id)));
      }}
    />
  );

  const typeSelect = (
    <Select
      mode="multiple"
      allowClear
      size="small"
      placeholder="Виды работ (опционально)"
      style={{ width: '100%' }}
      value={costTypeIds}
      options={typeOptions}
      optionFilterProp="label"
      disabled={categoryIds.length === 0}
      onChange={(vals) => setScope(categoryIds, vals)}
    />
  );

  if (!compact) {
    return (
      <>
        {categorySelect}
        {typeSelect}
      </>
    );
  }

  // Индикатор активной области (только в компактном режиме чата).
  const catName = (id: string) => catsData?.data?.find((c) => c.id === id)?.name ?? id;
  const typeName = (id: string) => typesData?.data?.find((t) => t.id === id)?.name ?? id;
  const indicator =
    categoryIds.length === 0
      ? 'Область: весь справочник'
      : `Область: ${categoryIds.map(catName).join(', ')}` +
        (costTypeIds.length ? ` / ${costTypeIds.map(typeName).join(', ')}` : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{categorySelect}</div>
        <div style={{ flex: 1, minWidth: 0 }}>{typeSelect}</div>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 11.5 }} ellipsis={{ tooltip: indicator }}>
        {indicator}
      </Typography.Text>
    </div>
  );
}
