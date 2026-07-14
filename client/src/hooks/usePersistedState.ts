import { useCallback, useState } from 'react';

// Значение состояния, переживающее перезагрузку страницы (localStorage, JSON).
// В отличие от usePersistedTab хранит произвольный тип T. `undefined` сериализуется как
// `null` (JSON.stringify(undefined) даёт undefined и ломает JSON.parse при чтении).
export function usePersistedState<T>(storageKey: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return defaultValue;
      const parsed = JSON.parse(raw) as T | null;
      return parsed == null ? defaultValue : parsed;
    } catch {
      return defaultValue;
    }
  });

  const setPersisted = useCallback(
    (next: T) => {
      setValue(next);
      try {
        // undefined хранить как null — иначе JSON.stringify(undefined) === undefined.
        localStorage.setItem(storageKey, JSON.stringify(next ?? null));
      } catch {
        /* localStorage недоступен — игнорируем */
      }
    },
    [storageKey],
  );

  return [value, setPersisted] as const;
}
