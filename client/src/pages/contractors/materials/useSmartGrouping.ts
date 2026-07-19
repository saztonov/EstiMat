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

/** Ключ — смета + подрядчик: у каждого подрядчика свой расчёт. */
const KEY = (estimateId: string, contractorId: string) => ['material-grouping', estimateId, contractorId] as const;
const CALLS_KEY = (jobId: string) => ['material-grouping-calls', jobId] as const;
const CALL_KEY = (jobId: string, callId: string) => ['material-grouping-call', jobId, callId] as const;

/**
 * Группировка scope (смета + подрядчик). Сам этот запрос и заказывает расчёт: сервер ставит задание
 * при чтении, то есть по открытию вкладки. Пока считается — поллинг (как в ИИ-чате): задание
 * фоновое, и клиентский таймаут запроса роли не играет. Без выбранного подрядчика не грузим.
 */
export function useSmartGroupingJob(estimateId: string, contractorId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: KEY(estimateId, contractorId ?? ''),
    queryFn: () => getLatestGroupingJob(estimateId, contractorId!),
    enabled: enabled && !!estimateId && !!contractorId,
    refetchInterval: (q) => {
      const data = q.state.data;
      // Поллим по active, а не по data: data — это последний готовый результат, и во время
      // пересчёта он остаётся 'ready'.
      if (data?.active) return 1500;
      // Пересчёт отложен: перечитываем роут ровно к сроку — сервер поставит задание, и включится
      // ветка выше. Без этого открытая вкладка ждала бы перезагрузки страницы, а обещанный
      // пересчёт так и не начался бы.
      if (data?.nextAutoRunAt) {
        return Math.max(1000, new Date(data.nextAutoRunAt).getTime() - Date.now());
      }
      return false;
    },
  });
}

/** Пересчёт (админ) для scope. Настройки не передаются — их определяет сервер. */
export function useRunSmartGrouping(estimateId: string, contractorId: string | null) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: (vars: { force?: boolean } = {}) =>
      createGroupingJob({
        estimateId,
        contractorId: contractorId ?? undefined,
        clientRequestId: crypto.randomUUID(),
        force: vars.force,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(estimateId, contractorId ?? '') }),
    onError: (err: Error) => {
      // Понятный текст вместо «409»: занято другим прогоном либо ИИ не настроен.
      const code = err instanceof ApiError ? (err.data as { code?: string } | undefined)?.code : undefined;
      if (code === 'already_running') {
        message.info('Группировка уже выполняется');
        queryClient.invalidateQueries({ queryKey: KEY(estimateId, contractorId ?? '') });
        return;
      }
      message.error(err.message);
    },
  });
}

export function useCancelSmartGrouping(estimateId: string, contractorId: string | null) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: (id: string) => cancelGroupingJob(id),
    onSuccess: (_res, id) => {
      // Правим кэш вместо немедленного invalidate: refetch пришёл бы раньше, чем сервер погасит
      // задание, вернул бы прежний active — и плашка «идёт расчёт» мигала бы после остановки.
      // Прежний результат при этом остаётся на экране.
      queryClient.setQueryData<LatestGroupingJobResponse>(KEY(estimateId, contractorId ?? ''), (prev) => {
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
      void queryClient.invalidateQueries({ queryKey: KEY(estimateId, contractorId ?? '') });
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
