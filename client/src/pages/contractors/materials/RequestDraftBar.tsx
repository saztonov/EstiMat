// Панель набора заявки: тип, доля остатка для массовых действий, отмена, сводка и отправка.
//
// Отдельный блок над таблицей (flexShrink: 0), а не «липкая» шапка: тулбар вкладки и так лежит
// вне внутреннего скроллера и виден всегда.
import { Button, InputNumber, Segmented, Space, Tag, Tooltip, Popconfirm } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import { MATERIAL_REQUEST_TYPE_LABELS, type MaterialRequestType } from '@estimat/shared';
import { formatMoney } from '../../estimates/components/types';
import type { DraftStats } from './draftFill';

/** Доли остатка «в один клик». Остальное — произвольным вводом. */
const PRESETS = [25, 50, 75, 100];

interface Props {
  requestType: MaterialRequestType;
  percent: number;
  onPercentChange: (v: number) => void;
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
  percent,
  onPercentChange,
  stats,
  canUndo,
  onUndo,
  onCancel,
  onSubmit,
  submitting,
  onBehalfOf,
}: Props) {
  const preset = PRESETS.includes(percent) ? percent : 'custom';
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

      <Space size={4}>
        <span style={{ color: '#8c8c8c', fontSize: 13 }}>Доля остатка:</span>
        <Segmented
          size="small"
          value={preset}
          onChange={(v) => v !== 'custom' && onPercentChange(Number(v))}
          options={[
            ...PRESETS.map((p) => ({ label: `${p}%`, value: p })),
            { label: 'Своя', value: 'custom' },
          ]}
        />
        {preset === 'custom' && (
          // Массовая доля ограничена сотней: заказать запас сверх остатка можно построчно, а вот
          // разом превысить смету на сорока строках — это ошибка, которую не поймать внимательностью.
          <InputNumber
            size="small"
            min={0.01}
            max={100}
            step={5}
            value={percent}
            onChange={(v) => v != null && onPercentChange(v)}
            style={{ width: 80 }}
            suffix="%"
          />
        )}
      </Space>

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
