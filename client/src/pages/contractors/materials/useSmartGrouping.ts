import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import type { LatestGroupingJobResponse } from '@estimat/shared';
import { ApiError } from '../../../services/api';
import {
  cancelGroupingJob,
  createGroupingJob,
  getGroupingCall,
  getGroupingCalls,
  getLatestGroupingJob,
} from '../../../services/materialGrouping';

/** Ключ — только смета: результат общий, от отборов пользователя он не зависит. */
const KEY = (estimateId: string) => ['material-grouping', estimateId] as const;
const CALLS_KEY = (jobId: string) => ['material-grouping-calls', jobId] as const;
const CALL_KEY = (jobId: string, callId: string) => ['material-grouping-call', jobId, callId] as const;

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
    onSuccess: (_res, id) => {
      // Правим кэш вместо немедленного invalidate: refetch пришёл бы раньше, чем сервер погасит
      // задание, вернул бы прежний active — и плашка «идёт расчёт» мигала бы после остановки.
      // Прежний результат при этом остаётся на экране.
      queryClient.setQueryData<LatestGroupingJobResponse>(KEY(estimateId), (prev) => {
        if (!prev || prev.active?.id !== id) return prev;
        return {
          ...prev,
          active: null,
          autoRunSuppressed: 'manual_stop',
          lastAttempt: {
            id,
            status: 'cancelled',
            error: prev.active?.lastError ?? null,
            attempts: prev.active?.attempts ?? 1,
            stoppedByUser: true,
          },
        };
      });
      // Поллинг уже остановлен (active=null) — сверяемся с сервером один раз, без гонки.
      void queryClient.invalidateQueries({ queryKey: KEY(estimateId) });
    },
    onError: (err: Error) => message.error(err.message),
  });
}

/** Журнал обмена с моделью. Поллим только при открытом окне и живом задании. */
export function useGroupingCalls(jobId: string | null, enabled: boolean, active: boolean) {
  return useQuery({
    queryKey: CALLS_KEY(jobId ?? ''),
    queryFn: () => getGroupingCalls(jobId!),
    enabled: enabled && !!jobId,
    // 3 с, а не 1.5: журнал — вспомогательное окно, и список тяжелее прогресса.
    refetchInterval: active ? 3000 : false,
  });
}

/** Полный текст вызова. Грузится по раскрытию строки и не поллится: он уже не изменится. */
export function useGroupingCall(jobId: string | null, callId: string | null) {
  return useQuery({
    queryKey: CALL_KEY(jobId ?? '', callId ?? ''),
    queryFn: () => getGroupingCall(jobId!, callId!),
    enabled: !!jobId && !!callId,
    staleTime: 60_000,
  });
}
