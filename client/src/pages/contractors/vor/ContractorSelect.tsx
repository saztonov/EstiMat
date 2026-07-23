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
  disabled = false,
}: {
  options: ContractorOption[];
  value: string | undefined;
  onChange: (v: string) => void;
  /** Правка существующего назначения: подрядчик зафиксирован. */
  disabled?: boolean;
}) {
  return (
    <Select
      placeholder="Подрядчик"
      style={{ width: '100%' }}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      showSearch
      optionFilterProp="label"
      notFoundContent="Подрядчиков нет"
    />
  );
}
