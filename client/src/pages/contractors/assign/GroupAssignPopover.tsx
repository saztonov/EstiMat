import { useState } from 'react';
import { App, Button, Popover, Radio, Space, Tooltip, Divider } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import type { BulkAssignAllocation } from '@estimat/shared';
import { BulkAllocationFields, ContractorSelect } from './AssignFields';
import type { AssignScope, BulkAssignDraft } from './types';

/**
 * Назначение подрядчика на вид работ целиком (шапка блока).
 *
 * Три области в одном поповере, а не три кнопки рядом: подрядчик и доля — общие поля, и при
 * трёх кнопках было бы неясно, к какой из них они относятся. «На несколько работ» не назначает
 * сразу, а включает режим отметки — поэтому подпись кнопки для неё другая.
 */
export function GroupAssignPopover({
  contractorOptions,
  totalCount,
  unassignedCount,
  onAssign,
  onStartSelect,
}: {
  contractorOptions: { value: string; label: string }[];
  totalCount: number;
  unassignedCount: number;
  onAssign: (scope: 'all' | 'new', draft: BulkAssignDraft) => Promise<unknown>;
  onStartSelect: (draft: BulkAssignDraft) => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [contractorId, setContractorId] = useState<string | undefined>();
  const [allocation, setAllocation] = useState<BulkAssignAllocation>({ type: 'whole' });
  const [scope, setScope] = useState<AssignScope>('all');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!contractorId) return message.warning('Выберите подрядчика');
    const draft: BulkAssignDraft = { contractorId, allocation };
    if (scope === 'selected') {
      // Поповер закрываем сразу: дальше пользователь отмечает строки в таблице.
      setOpen(false);
      onStartSelect(draft);
      return;
    }
    setBusy(true);
    try {
      // Подтверждение перезаписи показывает вызывающий — ему известны и план, и итог.
      await onAssign(scope, draft);
      setOpen(false);
      setContractorId(undefined);
    } catch {
      /* ошибку покажет мутация */
    } finally {
      setBusy(false);
    }
  };

  const option = (title: string, hint: string) => (
    <>
      {title}
      <div style={{ color: 'var(--est-text-tertiary)', fontSize: 12, lineHeight: 1.3 }}>{hint}</div>
    </>
  );

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      title="Назначение подрядчика"
      content={
        <Space direction="vertical" style={{ width: 300 }} size={8}>
          <ContractorSelect options={contractorOptions} value={contractorId} onChange={setContractorId} />
          <BulkAllocationFields value={allocation} onChange={setAllocation} />

          <Divider style={{ margin: '4px 0' }} />
          <div style={{ color: 'var(--est-text-tertiary)', fontSize: 12 }}>Область назначения</div>
          <Radio.Group value={scope} onChange={(e) => setScope(e.target.value as AssignScope)}>
            <Space direction="vertical" size={6}>
              <Radio value="all">
                {option(`На весь вид (${totalCount})`, 'Перезапишет других подрядчиков')}
              </Radio>
              <Tooltip title={unassignedCount === 0 ? 'Все строки вида уже назначены' : undefined}>
                <Radio value="new" disabled={unassignedCount === 0}>
                  {option(`Назначить на новые (${unassignedCount})`, 'Только строки без подрядчика')}
                </Radio>
              </Tooltip>
              <Radio value="selected">
                {option('Назначить на несколько работ', 'Отметить строки галочками')}
              </Radio>
            </Space>
          </Radio.Group>

          <Space>
            <Button type="primary" size="small" loading={busy} onClick={submit}>
              {scope === 'selected' ? 'Перейти к выбору' : 'Назначить'}
            </Button>
            <Button size="small" onClick={() => setOpen(false)}>
              Отмена
            </Button>
          </Space>
        </Space>
      }
    >
      <Button type="link" size="small" icon={<UserOutlined />}>
        Назначение подрядчика
      </Button>
    </Popover>
  );
}
