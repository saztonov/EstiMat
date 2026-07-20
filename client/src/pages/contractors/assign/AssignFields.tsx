import { InputNumber, Select, Space } from 'antd';
import type { BulkAssignAllocation } from '@estimat/shared';
import type { AssignMode } from './types';

interface ContractorOption {
  value: string;
  label: string;
}

/** Выбор подрядчика — общий для построчного и массового назначения. */
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

/**
 * Доля для МАССОВОГО назначения: весь объём или процент.
 * «Остатка» здесь нет намеренно — при перезаписи чужие назначения снимаются, и остаток строки
 * равен всему её объёму; записывать вместо этого конкретное число значило бы показывать
 * «Подрядчик · 145.5» там, где по смыслу «весь объём».
 */
export function BulkAllocationFields({
  value,
  onChange,
}: {
  value: BulkAssignAllocation;
  onChange: (v: BulkAssignAllocation) => void;
}) {
  return (
    <>
      <Select
        style={{ width: '100%' }}
        value={value.type}
        onChange={(t) => onChange(t === 'percent' ? { type: 'percent', percent: 100 } : { type: 'whole' })}
        options={[
          { value: 'whole', label: 'Весь объём' },
          { value: 'percent', label: 'Процент' },
        ]}
      />
      {value.type === 'percent' && (
        <InputNumber
          min={0.01}
          max={100}
          value={value.percent}
          onChange={(v) => onChange({ type: 'percent', percent: v ?? 0 })}
          addonAfter="%"
          style={{ width: '100%' }}
        />
      )}
    </>
  );
}

/** Доля для ПОСТРОЧНОГО назначения: остаток, процент или абсолютный объём (прежнее поведение). */
export function RowAllocationFields({
  mode,
  onModeChange,
  percent,
  onPercentChange,
  qty,
  onQtyChange,
}: {
  mode: AssignMode;
  onModeChange: (m: AssignMode) => void;
  percent: number;
  onPercentChange: (v: number) => void;
  qty: number;
  onQtyChange: (v: number) => void;
}) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <Select
        style={{ width: '100%' }}
        value={mode}
        onChange={(v) => onModeChange(v as AssignMode)}
        options={[
          { value: 'remainder', label: 'Весь остаток' },
          { value: 'percent', label: 'Процент' },
          { value: 'qty', label: 'Объём' },
        ]}
      />
      {mode === 'percent' && (
        <InputNumber
          min={0.01}
          max={100}
          value={percent}
          onChange={(v) => onPercentChange(v ?? 0)}
          addonAfter="%"
          style={{ width: '100%' }}
        />
      )}
      {mode === 'qty' && (
        <InputNumber
          min={0.01}
          value={qty}
          onChange={(v) => onQtyChange(v ?? 0)}
          placeholder="Объём"
          style={{ width: '100%' }}
        />
      )}
    </Space>
  );
}
