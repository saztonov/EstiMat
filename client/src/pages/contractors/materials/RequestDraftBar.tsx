// Панель набора заявки: тип, отмена последнего действия, сводка и отправка.
//
// Отдельный блок над таблицей (flexShrink: 0), а не «липкая» шапка: тулбар вкладки и так лежит
// вне внутреннего скроллера и виден всегда.
import { Button, Tag, Tooltip, Popconfirm } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import { MATERIAL_REQUEST_TYPE_LABELS, type MaterialRequestType } from '@estimat/shared';
import { formatMoney } from '../../estimates/components/types';
import type { DraftStats } from './draftFill';

interface Props {
  requestType: MaterialRequestType;
  stats: DraftStats;
  canUndo: boolean;
  onUndo: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  /** Подпись «за кого заявка» — у сотрудника, набирающего за подрядчика. */
  onBehalfOf?: string | null;
}

export function RequestDraftBar({
  requestType,
  stats,
  canUndo,
  onUndo,
  onCancel,
  onSubmit,
  submitting,
  onBehalfOf,
}: Props) {
  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: 12,
      }}
    >
      <Tag color="blue">{MATERIAL_REQUEST_TYPE_LABELS[requestType]}</Tag>
      {onBehalfOf && <Tag>За: {onBehalfOf}</Tag>}

      <Tooltip title="Отменить последнее массовое действие">
        <Button
          type="text"
          size="small"
          aria-label="Отменить последнее массовое действие"
          icon={<UndoOutlined />}
          disabled={!canUndo}
          onClick={onUndo}
        />
      </Tooltip>

      <span style={{ color: stats.count > 0 ? '#1677ff' : '#8c8c8c', fontSize: 13 }}>
        В заявке: {stats.count} поз.
        {stats.pricedCount > 0 && ` · ${formatMoney(stats.money)}`}
        {stats.pricedCount > 0 && stats.pricedCount < stats.count && (
          <span style={{ color: '#8c8c8c' }}>
            {' '}
            (оценено {stats.pricedCount} из {stats.count})
          </span>
        )}
      </span>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {stats.count > 0 ? (
          <Popconfirm
            title="Отменить набор заявки?"
            description="Введённые количества будут потеряны"
            okText="Отменить набор"
            cancelText="Продолжить"
            onConfirm={onCancel}
          >
            <Button size="small">Отмена</Button>
          </Popconfirm>
        ) : (
          <Button size="small" onClick={onCancel}>
            Отмена
          </Button>
        )}
        <Button type="primary" size="small" loading={submitting} disabled={stats.count === 0} onClick={onSubmit}>
          Проверить и создать ({stats.count})
        </Button>
      </div>
    </div>
  );
}
