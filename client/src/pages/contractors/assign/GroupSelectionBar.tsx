import { Button, Popover, Space, Tooltip } from 'antd';
import type { BulkAssignAllocation } from '@estimat/shared';
import { BulkAllocationFields, ContractorSelect } from './AssignFields';
import { allocationLabel, type BulkAssignDraft } from './types';

/**
 * Панель режима отметки строк — живёт в шапке блока вида работ, рядом с отмеченными строками
 * (а не в общем тулбаре вкладки: операция относится к одному виду, и панель должна уезжать
 * вместе с ним при скролле).
 */
export function GroupSelectionBar({
  draft,
  onDraftChange,
  selectedCount,
  contractorOptions,
  busy,
  onSelectAll,
  onClear,
  onAssign,
  onCancel,
}: {
  draft: BulkAssignDraft;
  onDraftChange: (d: BulkAssignDraft) => void;
  selectedCount: number;
  contractorOptions: { value: string; label: string }[];
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onAssign: () => void;
  onCancel: () => void;
}) {
  const contractorName =
    contractorOptions.find((o) => o.value === draft.contractorId)?.label ?? 'Подрядчик не выбран';

  return (
    // Клик по шапке блока выделяет вид работ; текст панели под штатное исключение по
    // селекторам не попадает, поэтому гасим всплытие на всей панели.
    <span onClick={(e) => e.stopPropagation()}>
      <Space size={6} wrap>
        <span style={{ fontSize: 12 }}>Отмечено: {selectedCount}</span>
        <Button type="text" size="small" onClick={onSelectAll}>
          Все
        </Button>
        <Button type="text" size="small" onClick={onClear} disabled={selectedCount === 0}>
          Снять
        </Button>
        <span style={{ color: 'var(--est-text-tertiary)', fontSize: 12 }}>
          {contractorName} · {allocationLabel(draft.allocation)}
        </span>
        <Popover
          trigger="click"
          title="Кому и сколько"
          content={
            <Space direction="vertical" style={{ width: 260 }} size={8}>
              <ContractorSelect
                options={contractorOptions}
                value={draft.contractorId}
                onChange={(contractorId) => onDraftChange({ ...draft, contractorId })}
              />
              <BulkAllocationFields
                value={draft.allocation}
                onChange={(allocation: BulkAssignAllocation) => onDraftChange({ ...draft, allocation })}
              />
            </Space>
          }
        >
          <Button type="link" size="small">
            Изменить
          </Button>
        </Popover>
        <Tooltip title={selectedCount === 0 ? 'Отметьте хотя бы одну работу' : undefined}>
          <Button type="primary" size="small" loading={busy} disabled={selectedCount === 0} onClick={onAssign}>
            Назначить
          </Button>
        </Tooltip>
        <Button size="small" onClick={onCancel}>
          Отмена
        </Button>
      </Space>
    </span>
  );
}
