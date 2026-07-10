import type { QueryClient } from '@tanstack/react-query';

interface InvalidateEstimateOpts {
  /** ID сметы (estimate.id). */
  estimateId: string;
  /** ID объекта (estimate.project_id) — для ключа объектной сметы. */
  projectId?: string | null;
}

// Единая инвалидация всех кэшей, зависящих от сметы. Смета грузится двумя путями
// с разными ключами (['estimate', id] и ['project-estimate', projectId]); бьём по обоим,
// чтобы не оставить stale-кеш при переходе /projects/:id ↔ /estimates/:id, а также
// обновить счётчики на списке объектов. Отдельный refetchKey не нужен — он всегда совпадает
// с одним из этих двух ключей (страница грузит смету ровно ими).
export function invalidateEstimateQueries(
  queryClient: QueryClient,
  { estimateId, projectId }: InvalidateEstimateOpts,
): void {
  queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
  if (projectId) queryClient.invalidateQueries({ queryKey: ['project-estimate', projectId] });
  queryClient.invalidateQueries({ queryKey: ['projects-with-stats'] });
  // Доступность кнопки «Отменить» зависит от последнего действия — обновляем после любой мутации.
  queryClient.invalidateQueries({ queryKey: ['estimate-undo-peek', estimateId] });
  // История ВОР и отметки строк (метка «В») — обновляем при событиях vor_created/vor_deleted
  // (и любых других изменениях сметы: удаление строки снимает связь vor_items).
  queryClient.invalidateQueries({ queryKey: ['estimate-vor', estimateId] });
  queryClient.invalidateQueries({ queryKey: ['estimate-vor-marks', estimateId] });
}
