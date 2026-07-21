import { useMemo, useState } from 'react';
import { Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

export interface SupplierSel { id: string; name: string; inn: string | null }

/** Выбор поставщика из справочника: поиск по названию/ИНН, ИНН подставляется автоматически. */
export function SupplierPicker({ value, onChange }: { value?: SupplierSel; onChange: (s?: SupplierSel) => void }) {
  const [search, setSearch] = useState('');
  const suppliersQ = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => api.get<{ data: SupplierSel[] }>(`/suppliers?q=${encodeURIComponent(search)}`),
  });
  const options = useMemo(() => {
    const list = suppliersQ.data?.data ?? [];
    const opts = list.map((s) => ({ value: s.id, label: s.inn ? `${s.name} (ИНН ${s.inn})` : s.name, supplier: s }));
    // Текущий выбор может не попасть в выдачу (лимит) — подмешиваем, чтобы не показывать UUID.
    if (value?.id && !opts.some((o) => o.value === value.id)) {
      opts.unshift({ value: value.id, label: value.inn ? `${value.name} (ИНН ${value.inn})` : value.name, supplier: value });
    }
    return opts;
  }, [suppliersQ.data, value]);
  return (
    <Select
      showSearch filterOption={false} onSearch={setSearch} loading={suppliersQ.isLoading}
      value={value?.id} options={options.map((o) => ({ value: o.value, label: o.label }))}
      placeholder="Поиск по названию или ИНН" style={{ width: '100%' }}
      onChange={(val) => onChange(options.find((o) => o.value === val)?.supplier)}
    />
  );
}
