import { Badge, Button, Divider, Popover, Radio, Space, Switch, Typography } from 'antd';
import { ApartmentOutlined } from '@ant-design/icons';
import { LEVEL_PRESETS, type LevelPresetKey, type MaterialLevelSettings } from './materialTree';

interface Props {
  value: MaterialLevelSettings;
  onToggle: (key: keyof MaterialLevelSettings, v: boolean) => void;
  onApplyPreset: (key: LevelPresetKey) => void;
  onReset: () => void;
  activePreset: LevelPresetKey | null;
  /** Сколько уровней отличается от привычного вида вкладки — счётчик на бейдже. */
  changedCount: number;
  disabled?: boolean;
}

const SWITCHES: { key: keyof MaterialLevelSettings; label: string; hint: string }[] = [
  { key: 'costType', label: 'Учитывать вид работ', hint: 'Отдельный уровень на каждый вид работ' },
  { key: 'location', label: 'Учитывать локацию', hint: 'Разделять по корпусам и этажам' },
  { key: 'locationType', label: 'Учитывать тип работы', hint: 'Разделять по типу строки (РП-1, МОП, ТПУ)' },
];

// Настройка уровней группировки материалов. Выключенный уровень не разделяет материалы,
// но исходные вид работ, локация и тип никуда не деваются — они видны в строке и в разбивке.
export function MaterialGroupingPopover({
  value,
  onToggle,
  onApplyPreset,
  onReset,
  activePreset,
  changedCount,
  disabled = false,
}: Props) {
  const content = (
    <Space direction="vertical" size="middle" style={{ width: 280 }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {SWITCHES.map((s) => (
          <Space key={s.key} size={8} align="start">
            <Switch size="small" checked={value[s.key]} onChange={(v) => onToggle(s.key, v)} />
            <div>
              <div style={{ fontSize: 13, color: '#595959' }}>{s.label}</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {s.hint}
              </Typography.Text>
            </div>
          </Space>
        ))}
      </Space>
      <div>
        <Typography.Text type="secondary">Готовые варианты</Typography.Text>
        <Radio.Group
          size="small"
          style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}
          value={activePreset}
          onChange={(e) => onApplyPreset(e.target.value as LevelPresetKey)}
        >
          {LEVEL_PRESETS.map((p) => (
            <Radio key={p.key} value={p.key} style={{ fontSize: 13 }}>
              {p.label}
            </Radio>
          ))}
        </Radio.Group>
      </div>
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
        <Button icon={<ApartmentOutlined />} disabled={disabled}>
          Группировка
        </Button>
      </Badge>
    </Popover>
  );
}
