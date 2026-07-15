// Презентация локации строки: бейджи «зоны / этажи / тип».
// Модель и разбор снимка — в ./location (чистые утилиты без React); здесь только рендер.
import { Tag } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';

export {
  buildZoneIndex,
  locationKey,
  locationParts,
  toLocationSnapshot,
  type LocationParts,
  type LocationSnapshot,
  type ZoneIndex,
} from './location';

interface Props {
  zoneNames: string[];
  floorsLabel: string;
  /** Типы отдельными бейджами: у сводного материала их может быть несколько. */
  typeLabels: string[];
}

// Бейджи локации: зоны (geekblue) · этажи (cyan) · типы (gold). Пусто — серый прочерк.
export function LocationBadges({ zoneNames, floorsLabel, typeLabels }: Props) {
  const empty = zoneNames.length === 0 && !floorsLabel && typeLabels.length === 0;
  if (empty) {
    return (
      <Tag style={{ margin: 0, color: '#bfbfbf' }}>
        <EnvironmentOutlined /> —
      </Tag>
    );
  }
  return (
    <>
      {zoneNames.map((n) => (
        <Tag key={n} color="geekblue" style={{ margin: 0, whiteSpace: 'normal' }}>
          {n}
        </Tag>
      ))}
      {floorsLabel && (
        <Tag color="cyan" style={{ margin: 0 }}>
          эт. {floorsLabel}
        </Tag>
      )}
      {typeLabels.map((t) => (
        <Tag key={t} color="gold" style={{ margin: 0 }}>
          {t}
        </Tag>
      ))}
    </>
  );
}

// Обёртка бейджей: перенос по строкам внутри ячейки таблицы.
export function LocationBadgesRow({ zoneNames, floorsLabel, typeLabels }: Props) {
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', maxWidth: '100%' }}>
      <LocationBadges zoneNames={zoneNames} floorsLabel={floorsLabel} typeLabels={typeLabels} />
    </span>
  );
}
