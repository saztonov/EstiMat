import { useQuery } from '@tanstack/react-query';
import type { AppSettingsResponse } from '@estimat/shared';
import { api } from '../services/api';

// Глобальные настройки приложения (управляются в Администрирование → Настройки).
export function useAppSettings() {
  return useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.get<AppSettingsResponse>('/settings'),
    staleTime: 60_000,
  });
}
