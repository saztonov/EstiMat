import { useCallback, useState } from 'react';

// Активная вкладка, переживающая перезагрузку страницы (localStorage).
export function usePersistedTab(storageKey: string, defaultKey: string) {
  const [tab, setTab] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) ?? defaultKey;
    } catch {
      return defaultKey;
    }
  });
  const setActiveTab = useCallback(
    (key: string) => {
      setTab(key);
      try {
        localStorage.setItem(storageKey, key);
      } catch {
        /* localStorage недоступен — игнорируем */
      }
    },
    [storageKey],
  );
  return [tab, setActiveTab] as const;
}
