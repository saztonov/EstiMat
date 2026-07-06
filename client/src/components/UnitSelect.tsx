import { Select } from 'antd';
import type { SelectProps } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

interface Unit {
  id: string;
  name: string;
}

// Строгий выбор единицы измерения из справочника units.
// value — само название единицы (в БД строки хранят текст, не FK).
export function UnitSelect(props: SelectProps<string>) {
  const { data } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get<{ data: Unit[] }>('/units'),
  });

  return (
    <Select<string>
      showSearch
      placeholder="Ед. изм."
      optionFilterProp="label"
      popupMatchSelectWidth={false}
      dropdownStyle={{ minWidth: 120 }}
      options={data?.data.map((u) => ({ value: u.name, label: u.name }))}
      {...props}
    />
  );
}
