import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import type { GroupingSettings } from '@estimat/shared';
import { ApiError } from '../../../services/api';
import {
  cancelGroupingJob,
  createGroupingJob,
  getLatestGroupingJob,
} from '../../../services/materialGrouping';

const KEY = (estimateId: string, contractorIds: string[]) =>
  ['material-grouping', estimateId, contractorIds.join(',')] as const;

/**
 * Последнее задание группировки в текущей области. Пока считается — поллинг (как в ИИ-чате):
 * задание фоновое, POST возвращает 202 сразу и клиентский таймаут запроса роли не играет.
 */
export function useSmartGroupingJob(estimateId: string, contractorIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: KEY(estimateId, contractorIds),
    queryFn: () => getLatestGroupingJob(estimateId, contractorIds),
    enabled: enabled && !!estimateId,
    refetchInterval: (q) => {
      const s = q.state.data?.data?.status;
      return s === 'running' || s === 'pending' ? 1500 : false;
    },
  });
}

export function useRunSmartGrouping(estimateId: string, contractorIds: string[]) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: (vars: { settings: GroupingSettings; force?: boolean }) =>
      createGroupingJob({
        estimateId,
        contractorIds: contractorIds.length ? contractorIds : undefined,
        settings: vars.settings,
        clientRequestId: crypto.randomUUID(),
        force: vars.force,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(estimateId, contractorIds) }),
    onError: (err: Error) => {
      // Понятный текст вместо «409»: занято другим прогоном либо ИИ не настроен.
      const code = err instanceof ApiError ? (err.data as { code?: string } | undefined)?.code : undefined;
      if (code === 'already_running') {
        message.info('Группировка по этим материалам уже выполняется');
        queryClient.invalidateQueries({ queryKey: KEY(estimateId, contractorIds) });
        return;
      }
      message.error(err.message);
    },
  });
}

export function useCancelSmartGrouping(estimateId: string, contractorIds: string[]) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: (id: string) => cancelGroupingJob(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(estimateId, contractorIds) }),
    onError: (err: Error) => message.error(err.message),
  });
}
