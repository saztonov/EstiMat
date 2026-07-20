import { useState, type ReactNode } from 'react';
import { App, Button, Popover, Space } from 'antd';
import { ContractorSelect, RowAllocationFields } from './AssignFields';
import type { AssignInput, AssignMode } from './types';

/**
 * Назначение подрядчика на ОДНУ строку сметы (ячейка «Исполнитель»).
 * Поведение прежнее: остаток строки, процент или абсолютный объём.
 */
export function RowAssignPopover({
  contractorOptions,
  onAssign,
  trigger,
}: {
  contractorOptions: { value: string; label: string }[];
  onAssign: (input: AssignInput) => Promise<unknown>;
  trigger: ReactNode;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [contractorId, setContractorId] = useState<string | undefined>();
  const [mode, setMode] = useState<AssignMode>('remainder');
  const [percent, setPercent] = useState(100);
  const [qty, setQty] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!contractorId) return message.warning('Выберите подрядчика');
    const input: AssignInput =
      mode === 'percent'
        ? { mode, contractorId, percent }
        : mode === 'qty'
          ? { mode, contractorId, qty }
          : { mode: 'remainder', contractorId };
    setBusy(true);
    try {
      await onAssign(input);
      setOpen(false);
      setContractorId(undefined);
    } catch {
      /* ошибку покажет мутация */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      title="Назначить исполнителя"
      content={
        <Space direction="vertical" style={{ width: 260 }} size={8}>
          <ContractorSelect options={contractorOptions} value={contractorId} onChange={setContractorId} />
          <RowAllocationFields
            mode={mode}
            onModeChange={setMode}
            percent={percent}
            onPercentChange={setPercent}
            qty={qty}
            onQtyChange={setQty}
          />
          <Space>
            <Button type="primary" size="small" loading={busy} onClick={submit}>
              Назначить
            </Button>
            <Button size="small" onClick={() => setOpen(false)}>
              Отмена
            </Button>
          </Space>
        </Space>
      }
    >
      {trigger}
    </Popover>
  );
}
