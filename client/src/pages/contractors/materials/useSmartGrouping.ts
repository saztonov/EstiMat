import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { ApiError } from '../../../services/api';
import {
  cancelGroupingJob,
  createGroupingJob,
  getLatestGroupingJob,
} from '../../../services/materialGrouping';

/** Ключ — только смета: результат общий, от отборов пользователя он не зависит. */
const KEY = (estimateId: string) => ['material-grouping', estimateId] as const;

/**
 * Группировка сметы. Пока считается — поллинг (как в ИИ-чате): задание фоновое, ставится само,
 * и клиентский таймаут запроса роли не играет.
 */
export function useSmartGroupingJob(estimateId: string, enabled: boolean) {
  return useQuery({
    queryKey: KEY(estimateId),
    queryFn: () => getLatestGroupingJob(estimateId),
    enabled: enabled && !!estimateId,
    // Поллим по active, а не по data: data — это последний готовый результат, и во время
    // пересчёта он остаётся 'ready'.
    refetchInterval: (q) => (q.state.data?.active ? 1500 : false),
  });
}

/** Пересчёт (админ). Настройки и область не передаются — их определяет сервер. */
export function useRunSmartGrouping(estimateId: string) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: (vars: { force?: boolean } = {}) =>
      createGroupingJob({
        estimateId,
        clientRequestId: crypto.randomUUID(),
        force: vars.force,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(estimateId) }),
    onError: (err: Error) => {
      // Понятный текст вместо «409»: занято другим прогоном либо ИИ не настроен.
      const code = err instanceof ApiError ? (err.data as { code?: string } | undefined)?.code : undefined;
      if (code === 'already_running') {
        message.info('Группировка по этой смете уже выполняется');
        queryClient.invalidateQueries({ queryKey: KEY(estimateId) });
        return;
      }
      message.error(err.message);
    },
  });
}

export function useCancelSmartGrouping(estimateId: string) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: (id: string) => cancelGroupingJob(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(estimateId) }),
    onError: (err: Error) => message.error(err.message),
  });
}
