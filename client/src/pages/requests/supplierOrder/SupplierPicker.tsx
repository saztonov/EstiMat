import { useMemo, useState } from 'react';
import { Select, App } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';

export interface SupplierSel { id: string; name: string; inn: string | null }

// Служебное значение опции «создать нового» — не может совпасть с UUID организации.
const NEW = '__new_supplier__';

/**
 * Выбор поставщика из справочника: поиск по названию/ИНН, ИНН подставляется автоматически.
 * Если нужного поставщика в справочнике нет — прямо из поиска можно завести нового
 * (создаётся организация типа «поставщик»; ИНН и реквизиты дозаполняются позже в справочнике).
 */
export function SupplierPicker({ value, onChange }: { value?: SupplierSel; onChange: (s?: SupplierSel) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const suppliersQ = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => api.get<{ data: SupplierSel[] }>(`/suppliers?q=${encodeURIComponent(search)}`),
  });

  const createMut = useMutation({
    mutationFn: (name: string) =>
      api.post<{ data: { id: string; name: string; inn: string | null } }>('/organizations', { name, type: 'supplier' }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      onChange({ id: res.data.id, name: res.data.name, inn: res.data.inn ?? null });
      message.success('Поставщик добавлен в справочник');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const list = suppliersQ.data?.data ?? [];
  const options = useMemo(() => {
    const opts: { value: string; label: string; supplier?: SupplierSel }[] =
      list.map((s) => ({ value: s.id, label: s.inn ? `${s.name} (ИНН ${s.inn})` : s.name, supplier: s }));
    // Текущий выбор может не попасть в выдачу (лимит) — подмешиваем, чтобы не показывать UUID.
    if (value?.id && !opts.some((o) => o.value === value.id)) {
      opts.unshift({ value: value.id, label: value.inn ? `${value.name} (ИНН ${value.inn})` : value.name, supplier: value });
    }
    // Нет точного совпадения по названию — предлагаем создать нового поставщика.
    const q = search.trim();
    if (q && !list.some((s) => s.name.toLowerCase() === q.toLowerCase())) {
      opts.push({ value: NEW, label: `+ Создать поставщика «${q}»` });
    }
    return opts;
  }, [list, value, search]);

  return (
    <Select
      showSearch filterOption={false} onSearch={setSearch}
      loading={suppliersQ.isLoading || createMut.isPending}
      value={value?.id} options={options.map((o) => ({ value: o.value, label: o.label }))}
      placeholder="Поиск по названию или ИНН" style={{ width: '100%' }}
      onChange={(val) => {
        if (val === NEW) { createMut.mutate(search.trim()); return; }
        onChange(options.find((o) => o.value === val)?.supplier);
      }}
    />
  );
}
