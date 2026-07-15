import { useCallback, useMemo } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import {
  DEFAULT_LEVELS,
  LEVEL_PRESETS,
  type LevelPresetKey,
  type MaterialLevelSettings,
} from './materialTree';

export type GroupingMode = 'standard' | 'smart';

// Из localStorage может прийти частичный или устаревший объект — приводим к валидной форме,
// иначе undefined-флаг молча выключит уровень.
function sanitize(v: MaterialLevelSettings | null | undefined): MaterialLevelSettings {
  return {
    costType: typeof v?.costType === 'boolean' ? v.costType : DEFAULT_LEVELS.costType,
    location: typeof v?.location === 'boolean' ? v.location : DEFAULT_LEVELS.location,
    locationType: typeof v?.locationType === 'boolean' ? v.locationType : DEFAULT_LEVELS.locationType,
  };
}

const same = (a: MaterialLevelSettings, b: MaterialLevelSettings) =>
  a.costType === b.costType && a.location === b.location && a.locationType === b.locationType;

/**
 * Настройки уровней группировки. Своё хранилище на режим — стандартный и умный настраиваются
 * независимо (требование задачи).
 */
export function useMaterialLevels(mode: GroupingMode) {
  const [raw, setRaw] = usePersistedState<MaterialLevelSettings>(
    `estimat:contractors-materials-levels-${mode}`,
    DEFAULT_LEVELS,
  );
  const levels = useMemo(() => sanitize(raw), [raw]);

  const setLevels = useCallback((next: MaterialLevelSettings) => setRaw(sanitize(next)), [setRaw]);
  const toggle = useCallback(
    (key: keyof MaterialLevelSettings, value: boolean) => setLevels({ ...levels, [key]: value }),
    [levels, setLevels],
  );
  const applyPreset = useCallback(
    (key: LevelPresetKey) => {
      const preset = LEVEL_PRESETS.find((p) => p.key === key);
      if (preset) setLevels(preset.levels);
    },
    [setLevels],
  );
  const reset = useCallback(() => setLevels(DEFAULT_LEVELS), [setLevels]);

  const activePreset = useMemo(
    () => LEVEL_PRESETS.find((p) => same(p.levels, levels))?.key ?? null,
    [levels],
  );
  // Счётчик на бейдж кнопки: сколько уровней отличается от привычного вида вкладки.
  const changedFromDefault = useMemo(
    () =>
      (['costType', 'location', 'locationType'] as const).filter((k) => levels[k] !== DEFAULT_LEVELS[k]).length,
    [levels],
  );

  return { levels, setLevels, toggle, applyPreset, reset, activePreset, changedFromDefault };
}
