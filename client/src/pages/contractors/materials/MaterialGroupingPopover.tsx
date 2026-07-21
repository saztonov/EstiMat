import { Badge, Button, Divider, Popover, Space, Switch, Tooltip, Typography } from 'antd';
import { ApartmentOutlined } from '@ant-design/icons';
import type { MaterialLevelSettings } from './materialTree';

interface Props {
  value: MaterialLevelSettings;
  onToggle: (key: keyof MaterialLevelSettings, v: boolean) => void;
  onReset: () => void;
  /** Сколько уровней отличается от привычного вида вкладки — счётчик на бейдже. */
  changedCount: number;
  disabled?: boolean;
}

export const LEVEL_SWITCHES: { key: keyof MaterialLevelSettings; label: string; hint: string }[] = [
  { key: 'costType', label: 'Учитывать вид работ', hint: 'Отдельный уровень на каждый вид работ' },
  { key: 'location', label: 'Учитывать локацию', hint: 'Разделять по корпусам и этажам' },
  { key: 'locationType', label: 'Учитывать тип работы', hint: 'Разделять по типу строки (РП-1, МОП, ТПУ)' },
];

/** Переключатели уровней. Общие с администрированием: там теми же уровнями настраивается ИИ. */
export function LevelSwitches({
  value,
  onToggle,
  disabled = false,
}: {
  value: MaterialLevelSettings;
  onToggle: (key: keyof MaterialLevelSettings, v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {LEVEL_SWITCHES.map((s) => (
        <Space key={s.key} size={8} align="start">
          <Switch size="small" checked={value[s.key]} disabled={disabled} onChange={(v) => onToggle(s.key, v)} />
          <div>
            <div style={{ fontSize: 13, color: 'var(--est-text-secondary)' }}>{s.label}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {s.hint}
            </Typography.Text>
          </div>
        </Space>
      ))}
    </Space>
  );
}

// Настройка уровней группировки материалов. Выключенный уровень не разделяет материалы,
// но исходные вид работ, локация и тип никуда не деваются — они видны в строке и в разбивке.
export function MaterialGroupingPopover({ value, onToggle, onReset, changedCount, disabled = false }: Props) {
  const content = (
    <Space direction="vertical" size="middle" style={{ width: 280 }}>
      <LevelSwitches value={value} onToggle={onToggle} />
      <Divider style={{ margin: 0 }} />
      <Button size="small" disabled={changedCount === 0} onClick={onReset}>
        Сбросить
      </Button>
    </Space>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="Группировка материалов"
      content={content}
      {...(disabled ? { open: false } : {})}
    >
      <Badge count={changedCount} size="small">
        {/* Tooltip внутри Popover, а не снаружи: иначе конфликтуют триггеры click и hover. */}
        <Tooltip title="Уровни группировки материалов">
          <Button icon={<ApartmentOutlined />} disabled={disabled}>
            Группировка
          </Button>
        </Tooltip>
      </Badge>
    </Popover>
  );
}
