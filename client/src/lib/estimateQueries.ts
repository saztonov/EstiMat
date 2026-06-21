import type { QueryClient, QueryKey } from '@tanstack/react-query';

interface InvalidateEstimateOpts {
  /** ID сметы (estimate.id). */
  estimateId: string;
  /** ID объекта (estimate.project_id) — для ключа объектной сметы. */
  projectId?: string | null;
  /** Ключ, которым смета была загружена текущей страницей (если известен). */
  refetchKey?: QueryKey;
}

// Единая инвалидация всех кэшей, зависящих от сметы. Смета грузится двумя путями
// с разными ключами (['estimate', id] и ['project-estimate', projectId]); бьём по всем,
// чтобы не оставить stale-кеш при переходе /projects/:id ↔ /estimates/:id, а также
// обновить счётчики на списке объектов.
export function invalidateEstimateQueries(
  queryClient: QueryClient,
  { estimateId, projectId, refetchKey }: InvalidateEstimateOpts,
): void {
  if (refetchKey) queryClient.invalidateQueries({ queryKey: refetchKey });
  queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
  if (projectId) queryClient.invalidateQueries({ queryKey: ['project-estimate', projectId] });
  queryClient.invalidateQueries({ queryKey: ['projects-with-stats'] });
}
