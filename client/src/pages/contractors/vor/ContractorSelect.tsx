import { Select } from 'antd';

interface ContractorOption {
  value: string;
  label: string;
}

/** Выбор подрядчика в модалке назначения ВОР. */
export function ContractorSelect({
  options,
  value,
  onChange,
}: {
  options: ContractorOption[];
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      placeholder="Подрядчик"
      style={{ width: '100%' }}
      value={value}
      onChange={onChange}
      options={options}
      showSearch
      optionFilterProp="label"
      notFoundContent="Подрядчиков нет"
    />
  );
}
