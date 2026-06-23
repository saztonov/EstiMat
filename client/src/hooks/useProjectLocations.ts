import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import type { ZoneNode, RoomType } from '../pages/estimates/components/location';

// Дерево зон объекта (корпус/парковка/стилобат/секция).
export function useProjectZones(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-zones', projectId],
    queryFn: () => api.get<{ data: { roots: ZoneNode[] } }>(`/projects/${projectId}/zones`),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });
}

// Активные типы помещений объекта (фолбэк на глобальные, если не настроены).
export function useProjectRoomTypes(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-room-types', projectId],
    queryFn: () => api.get<{ data: RoomType[] }>(`/projects/${projectId}/room-types`),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });
}

// Глобальный справочник типов помещений (для настройки активных в карточке объекта).
export function useRoomTypes() {
  return useQuery({
    queryKey: ['room-types'],
    queryFn: () => api.get<{ data: RoomType[] }>('/room-types'),
    staleTime: 5 * 60_000,
  });
}
