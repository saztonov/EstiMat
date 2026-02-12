'use client'

import { useMemo } from 'react'
import { useDeliveries, useDelivery, useDeliveryItems, useAcceptanceDocs } from '../api/queries'
import {
  useCreateDelivery,
  useUpdateDelivery,
  useAcceptDelivery,
  useUploadAcceptanceDoc,
  useCreateTransfer,
  useCreateSale,
  useCreateWriteoff,
  useCreateClaim,
} from '../api/mutations'
import type { DeliveryListParams } from '@estimat/shared'

/**
 * Composable hook for delivery list with mutations.
 */
export function useDeliveryList(params?: DeliveryListParams) {
  const deliveriesQuery = useDeliveries(params)
  const createMutation = useCreateDelivery()
  const updateMutation = useUpdateDelivery()

  const isLoading = deliveriesQuery.isLoading
  const isMutating = createMutation.isPending || updateMutation.isPending

  const deliveries = useMemo(
    () => deliveriesQuery.data?.data ?? [],
    [deliveriesQuery.data]
  )

  const total = deliveriesQuery.data?.total ?? 0

  return {
    deliveries,
    total,
    isLoading,
    isError: deliveriesQuery.isError,
    error: deliveriesQuery.error,
    refetch: deliveriesQuery.refetch,

    createDelivery: createMutation.mutateAsync,
    updateDelivery: updateMutation.mutateAsync,
    isMutating,
  }
}

/**
 * Composable hook for a single delivery detail with items and docs.
 */
export function useDeliveryDetail(id: string | undefined) {
  const deliveryQuery = useDelivery(id)
  const itemsQuery = useDeliveryItems(id)
  const docsQuery = useAcceptanceDocs(id)
  const updateMutation = useUpdateDelivery()
  const acceptMutation = useAcceptDelivery()
  const uploadDocMutation = useUploadAcceptanceDoc()
  const transferMutation = useCreateTransfer()
  const saleMutation = useCreateSale()
  const writeoffMutation = useCreateWriteoff()
  const claimMutation = useCreateClaim()

  return {
    delivery: deliveryQuery.data,
    items: itemsQuery.data ?? [],
    docs: docsQuery.data ?? [],
    isLoading: deliveryQuery.isLoading || itemsQuery.isLoading,
    isError: deliveryQuery.isError || itemsQuery.isError,
    error: deliveryQuery.error ?? itemsQuery.error,
    refetch: () => {
      deliveryQuery.refetch()
      itemsQuery.refetch()
      docsQuery.refetch()
    },

    updateDelivery: updateMutation.mutateAsync,
    acceptDelivery: acceptMutation.mutateAsync,
    uploadDoc: uploadDocMutation.mutateAsync,
    createTransfer: transferMutation.mutateAsync,
    createSale: saleMutation.mutateAsync,
    createWriteoff: writeoffMutation.mutateAsync,
    createClaim: claimMutation.mutateAsync,
    isMutating:
      updateMutation.isPending ||
      acceptMutation.isPending ||
      uploadDocMutation.isPending ||
      transferMutation.isPending ||
      saleMutation.isPending ||
      writeoffMutation.isPending ||
      claimMutation.isPending,
  }
}
