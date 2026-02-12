'use client'

import { useMemo } from 'react'
import { usePurchaseOrders, usePurchaseOrder, usePurchaseOrderItems } from '../api/queries'
import {
  useCreatePurchaseOrder,
  useUpdatePurchaseOrder,
  useConfirmPurchaseOrder,
  useUpdatePurchaseOrderStatus,
  useCreatePoItem,
  useUpdatePoItem,
  useDeletePoItem,
} from '../api/mutations'
import type { PurchaseOrderListParams } from '@estimat/shared'

/**
 * Composable hook for purchase order list with mutations.
 */
export function usePurchaseOrderList(params?: PurchaseOrderListParams) {
  const ordersQuery = usePurchaseOrders(params)
  const createMutation = useCreatePurchaseOrder()
  const updateMutation = useUpdatePurchaseOrder()
  const confirmMutation = useConfirmPurchaseOrder()

  const isLoading = ordersQuery.isLoading
  const isMutating = createMutation.isPending || updateMutation.isPending || confirmMutation.isPending

  const orders = useMemo(
    () => ordersQuery.data?.data ?? [],
    [ordersQuery.data]
  )

  const total = ordersQuery.data?.total ?? 0

  return {
    orders,
    total,
    isLoading,
    isError: ordersQuery.isError,
    error: ordersQuery.error,
    refetch: ordersQuery.refetch,

    createOrder: createMutation.mutateAsync,
    updateOrder: updateMutation.mutateAsync,
    confirmOrder: confirmMutation.mutateAsync,
    isMutating,
  }
}

/**
 * Composable hook for a single purchase order detail with items.
 */
export function usePurchaseOrderDetail(id: string | undefined) {
  const orderQuery = usePurchaseOrder(id)
  const itemsQuery = usePurchaseOrderItems(id)
  const updateMutation = useUpdatePurchaseOrder()
  const confirmMutation = useConfirmPurchaseOrder()
  const statusMutation = useUpdatePurchaseOrderStatus()
  const createItemMutation = useCreatePoItem()
  const updateItemMutation = useUpdatePoItem()
  const deleteItemMutation = useDeletePoItem()

  return {
    order: orderQuery.data,
    items: itemsQuery.data ?? [],
    isLoading: orderQuery.isLoading || itemsQuery.isLoading,
    isError: orderQuery.isError || itemsQuery.isError,
    error: orderQuery.error ?? itemsQuery.error,
    refetch: () => {
      orderQuery.refetch()
      itemsQuery.refetch()
    },

    updateOrder: updateMutation.mutateAsync,
    confirmOrder: confirmMutation.mutateAsync,
    updateStatus: statusMutation.mutateAsync,
    createItem: createItemMutation.mutateAsync,
    updateItem: updateItemMutation.mutateAsync,
    deleteItem: deleteItemMutation.mutateAsync,
    isMutating:
      updateMutation.isPending ||
      confirmMutation.isPending ||
      statusMutation.isPending ||
      createItemMutation.isPending ||
      updateItemMutation.isPending ||
      deleteItemMutation.isPending,
  }
}
