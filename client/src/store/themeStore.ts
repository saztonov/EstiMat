/**
 * Оформление портала: дневная / ночная тема.
 *
 * Значение хранится в localStorage (persist гидрируется синхронно при импорте модуля, поэтому
 * первый рендер уже видит выбранный режим). Тот же ключ читает анти-FOUC-скрипт в index.html —
 * при изменении имени ключа править и там.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'light',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'estimat:theme', version: 1 },
  ),
);
