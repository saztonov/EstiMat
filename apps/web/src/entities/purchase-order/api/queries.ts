'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  PurchaseOrderWithRelations,
  PoItemWithRelations,
  PurchaseOrderListParams,
  PaginatedResult,
  ApiResponse,
} from '@estimat/shared'

// ============================================================================
// Purchase Order query keys
// ============================================================================

export const purchaseOrderKeys = {
  all: ['purchase-orders'] as const,
  lists: () => [...purchaseOrderKeys.all, 'list'] as const,
  list: (params?: PurchaseOrderListParams) => [...purchaseOrderKeys.lists(), params] as const,
  details: () => [...purchaseOrderKeys.all, 'detail'] as const,
  detail: (id: string) => [...purchaseOrderKeys.details(), id] as const,
  items: (orderId: string) => [...purchaseOrderKeys.all, 'items', orderId] as const,
}

// ============================================================================
// Fetch functions
// ============================================================================

function buildSearchParams(params?: Record<string, unknown>): string {
  if (!params) return ''
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value))
    }
  })
  const query = searchParams.toString()
  return query ? `?${query}` : ''
}

async function fetchPurchaseOrders(params?: PurchaseOrderListParams): Promise<PaginatedResult<PurchaseOrderWithRelations>> {
  const url = `/api/v1/purchase-orders${buildSearchParams(params as Record<string, unknown>)}`
  const res = await fetch(url)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки заказов на закупку')
  }

  return res.json()
}

async function fetchPurchaseOrder(id: string): Promise<PurchaseOrderWithRelations> {
  const res = await fetch(`/api/v1/purchase-orders/${id}`)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки заказа на закупку')
  }

  const body: ApiResponse<PurchaseOrderWithRelations> = await res.json()
  return body.data!
}

async function fetchPurchaseOrderItems(orderId: string): Promise<PoItemWithRelations[]> {
  const res = await fetch(`/api/v1/purchase-orders/${orderId}/items`)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки позиций заказа')
  }

  const body: ApiResponse<PoItemWithRelations[]> = await res.json()
  return body.data!
}

// ============================================================================
// Query hooks
// ============================================================================

export function usePurchaseOrders(params?: PurchaseOrderListParams) {
  return useQuery({
    queryKey: purchaseOrderKeys.list(params),
    queryFn: () => fetchPurchaseOrders(params),
  })
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: purchaseOrderKeys.detail(id!),
    queryFn: () => fetchPurchaseOrder(id!),
    enabled: !!id,
  })
}

export function usePurchaseOrderItems(orderId: string | undefined) {
  return useQuery({
    queryKey: purchaseOrderKeys.items(orderId!),
    queryFn: () => fetchPurchaseOrderItems(orderId!),
    enabled: !!orderId,
  })
}
