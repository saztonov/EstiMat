import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

/** Счётчики непрочитанных комментариев по заявкам (для бейджей в списках). */
export function useUnreadCounts() {
  const { data } = useQuery({
    queryKey: ['requests', 'unread-counts'],
    queryFn: () => api.get<{ data: Record<string, number> }>('/requests/comments/unread-counts'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  return data?.data ?? {};
}
