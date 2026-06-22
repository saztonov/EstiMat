import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AiJob } from '@estimat/shared';
import { getAiJob } from '../services/aiExtract';
import { ApiError } from '../services/api';
import { useAiExtractStore, useExtractUi } from '../store/aiExtractStore';

// Финальные статусы — поллинг останавливаем (ready транзитный, продолжаем опрашивать).
const FINAL: AiJob['status'][] = ['applied', 'failed', 'cancelled'];

// Поллинг статуса задания РД. jobId берётся из устойчивого стора (переживает ремоунт
// панели), поэтому хук можно вызывать как из самой панели, так и из тулбара-индикатора —
// общий queryKey ['ai-job', jobId] дедуплицирует запросы в TanStack Query.
export function useAiExtractJob(estimateId: string) {
  const { jobId } = useExtractUi(estimateId);
  const patch = useAiExtractStore((s) => s.patch);

  const { data, error } = useQuery({
    queryKey: ['ai-job', jobId],
    queryFn: () => getAiJob(jobId as string),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.data.status;
      return s && FINAL.includes(s) ? false : 2000;
    },
  });

  // Задание удалено/недоступно (404) — сбрасываем ссылку, чтобы индикатор не висел.
  useEffect(() => {
    if (jobId && error instanceof ApiError && error.status === 404) {
      patch(estimateId, { jobId: null });
    }
  }, [jobId, error, estimateId, patch]);

  const job: AiJob | undefined = data?.data;
  const isActive = job?.status === 'pending' || job?.status === 'running';
  return { job, jobId, isActive };
}
