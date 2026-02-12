'use client'

import { useMemo } from 'react'
import { useTenders, useTender, useTenderLots, useLongTermOrders } from '../api/queries'
import {
  useCreateTender,
  useUpdateTender,
  usePublishTender,
  useAwardTender,
  useCreateLongTermOrder,
  useUpdateLongTermOrder,
} from '../api/mutations'
import type { TenderListParams } from '@estimat/shared'
import type { LongTermOrderListParams } from '../types'

/**
 * Composable hook for tender list with mutations.
 */
export function useTenderList(params?: TenderListParams) {
  const tendersQuery = useTenders(params)
  const createMutation = useCreateTender()
  const updateMutation = useUpdateTender()
  const publishMutation = usePublishTender()

  const isLoading = tendersQuery.isLoading
  const isMutating = createMutation.isPending || updateMutation.isPending || publishMutation.isPending

  const tenders = useMemo(
    () => tendersQuery.data?.data ?? [],
    [tendersQuery.data]
  )

  const total = tendersQuery.data?.total ?? 0

  return {
    tenders,
    total,
    isLoading,
    isError: tendersQuery.isError,
    error: tendersQuery.error,
    refetch: tendersQuery.refetch,

    createTender: createMutation.mutateAsync,
    updateTender: updateMutation.mutateAsync,
    publishTender: publishMutation.mutateAsync,
    isMutating,
  }
}

/**
 * Composable hook for a single tender detail with its lots.
 */
export function useTenderDetail(id: string | undefined) {
  const tenderQuery = useTender(id)
  const lotsQuery = useTenderLots(id)
  const updateMutation = useUpdateTender()
  const publishMutation = usePublishTender()
  const awardMutation = useAwardTender()

  return {
    tender: tenderQuery.data,
    lots: lotsQuery.data ?? [],
    isLoading: tenderQuery.isLoading || lotsQuery.isLoading,
    isError: tenderQuery.isError || lotsQuery.isError,
    error: tenderQuery.error ?? lotsQuery.error,
    refetch: () => {
      tenderQuery.refetch()
      lotsQuery.refetch()
    },

    updateTender: updateMutation.mutateAsync,
    publishTender: publishMutation.mutateAsync,
    awardTender: awardMutation.mutateAsync,
    isMutating: updateMutation.isPending || publishMutation.isPending || awardMutation.isPending,
  }
}

/**
 * Composable hook for long-term orders list.
 */
export function useLongTermOrderList(params?: LongTermOrderListParams) {
  const ordersQuery = useLongTermOrders(params)
  const createMutation = useCreateLongTermOrder()
  const updateMutation = useUpdateLongTermOrder()

  const orders = useMemo(
    () => ordersQuery.data?.data ?? [],
    [ordersQuery.data]
  )

  return {
    orders,
    total: ordersQuery.data?.total ?? 0,
    isLoading: ordersQuery.isLoading,
    isError: ordersQuery.isError,
    error: ordersQuery.error,
    refetch: ordersQuery.refetch,

    createOrder: createMutation.mutateAsync,
    updateOrder: updateMutation.mutateAsync,
    isMutating: createMutation.isPending || updateMutation.isPending,
  }
}
