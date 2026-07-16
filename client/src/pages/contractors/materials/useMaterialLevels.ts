import { useCallback, useMemo } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { DEFAULT_LEVELS, type MaterialLevelSettings } from './materialTree';

// Из localStorage может прийти частичный или устаревший объект — приводим к валидной форме,
// иначе undefined-флаг молча выключит уровень.
function sanitize(v: MaterialLevelSettings | null | undefined): MaterialLevelSettings {
  return {
    costType: typeof v?.costType === 'boolean' ? v.costType : DEFAULT_LEVELS.costType,
    location: typeof v?.location === 'boolean' ? v.location : DEFAULT_LEVELS.location,
    locationType: typeof v?.locationType === 'boolean' ? v.locationType : DEFAULT_LEVELS.locationType,
  };
}

/**
 * Настройки уровней стандартной группировки — личные, живут в localStorage.
 *
 * У умной группировки своих уровней больше нет: её результат один на смету и одинаков для всех,
 * поэтому границы групп задаёт администратор (Администрирование → Нейросети → Промпты).
 */
export function useMaterialLevels() {
  const [raw, setRaw] = usePersistedState<MaterialLevelSettings>(
    'estimat:contractors-materials-levels-standard',
    DEFAULT_LEVELS,
  );
  const levels = useMemo(() => sanitize(raw), [raw]);

  const setLevels = useCallback((next: MaterialLevelSettings) => setRaw(sanitize(next)), [setRaw]);
  const toggle = useCallback(
    (key: keyof MaterialLevelSettings, value: boolean) => setLevels({ ...levels, [key]: value }),
    [levels, setLevels],
  );
  const reset = useCallback(() => setLevels(DEFAULT_LEVELS), [setLevels]);

  // Счётчик на бейдж кнопки: сколько уровней отличается от привычного вида вкладки.
  const changedFromDefault = useMemo(
    () =>
      (['costType', 'location', 'locationType'] as const).filter((k) => levels[k] !== DEFAULT_LEVELS[k]).length,
    [levels],
  );

  return { levels, setLevels, toggle, reset, changedFromDefault };
}
