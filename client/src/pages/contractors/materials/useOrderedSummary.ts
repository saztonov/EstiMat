import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { buildOrderedMaps, type OrderedDto } from './prices';

interface OrderedResponse {
  data: OrderedDto[];
  meta: { requestCount: number };
}

/**
 * Сводка заявок по смете: заказанные количества, цены из закупок и число заявок.
 *
 * Один запрос на всё: цена приходит вместе с «Заказано», а счётчик заявок — в meta, иначе
 * виджет в шапке тянул бы ради одного числа список заявок.
 *
 * Ключ запроса совпадает с ключом вкладки, поэтому шапка и таблица переиспользуют один кэш,
 * пока отбор по подрядчикам не задан.
 */
export function useOrderedSummary(estimateId: string, viewerIsContractor: boolean, contractorIds: string[] = []) {
  const scope = viewerIsContractor ? 'me' : contractorIds.join(',');
  const query = useQuery({
    queryKey: ['material-ordered', estimateId, scope],
    queryFn: () => {
      const params = new URLSearchParams({ estimateId });
      if (!viewerIsContractor && contractorIds.length) params.set('contractorIds', contractorIds.join(','));
      return api.get<OrderedResponse>(`/material-requests/ordered?${params.toString()}`);
    },
    enabled: !!estimateId,
    // Согласуем обновление с материалами подрядчика (contractor-my-items тоже refetchOnWindowFocus):
    // иначе после согласования материалы перейдут на id-ключи, а карта «Заказано» останется из
    // старого кэша и колонка опустеет до ручного обновления.
    refetchOnWindowFocus: true,
  });

  const maps = useMemo(() => buildOrderedMaps(query.data?.data ?? []), [query.data]);

  return {
    ordered: maps.ordered,
    price: maps.price,
    requestCount: query.data?.meta?.requestCount ?? 0,
    isLoading: query.isLoading,
  };
}
