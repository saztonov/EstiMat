'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  DeliveryWithRelations,
  DeliveryItemWithRelations,
  AcceptanceDoc,
  DeliveryListParams,
  PaginatedResult,
  ApiResponse,
} from '@estimat/shared'

// ============================================================================
// Delivery query keys
// ============================================================================

export const deliveryKeys = {
  all: ['deliveries'] as const,
  lists: () => [...deliveryKeys.all, 'list'] as const,
  list: (params?: DeliveryListParams) => [...deliveryKeys.lists(), params] as const,
  details: () => [...deliveryKeys.all, 'detail'] as const,
  detail: (id: string) => [...deliveryKeys.details(), id] as const,
  items: (deliveryId: string) => [...deliveryKeys.all, 'items', deliveryId] as const,
  docs: (deliveryId: string) => [...deliveryKeys.all, 'docs', deliveryId] as const,
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

async function fetchDeliveries(params?: DeliveryListParams): Promise<PaginatedResult<DeliveryWithRelations>> {
  const url = `/api/v1/deliveries${buildSearchParams(params as Record<string, unknown>)}`
  const res = await fetch(url)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки поставок')
  }

  return res.json()
}

async function fetchDelivery(id: string): Promise<DeliveryWithRelations> {
  const res = await fetch(`/api/v1/deliveries/${id}`)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки поставки')
  }

  const body: ApiResponse<DeliveryWithRelations> = await res.json()
  return body.data!
}

async function fetchDeliveryItems(deliveryId: string): Promise<DeliveryItemWithRelations[]> {
  const res = await fetch(`/api/v1/deliveries/${deliveryId}/items`)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки позиций поставки')
  }

  const body: ApiResponse<DeliveryItemWithRelations[]> = await res.json()
  return body.data!
}

async function fetchAcceptanceDocs(deliveryId: string): Promise<AcceptanceDoc[]> {
  const res = await fetch(`/api/v1/deliveries/${deliveryId}/docs`)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки документов приёмки')
  }

  const body: ApiResponse<AcceptanceDoc[]> = await res.json()
  return body.data!
}

// ============================================================================
// Query hooks
// ============================================================================

export function useDeliveries(params?: DeliveryListParams) {
  return useQuery({
    queryKey: deliveryKeys.list(params),
    queryFn: () => fetchDeliveries(params),
  })
}

export function useDelivery(id: string | undefined) {
  return useQuery({
    queryKey: deliveryKeys.detail(id!),
    queryFn: () => fetchDelivery(id!),
    enabled: !!id,
  })
}

export function useDeliveryItems(deliveryId: string | undefined) {
  return useQuery({
    queryKey: deliveryKeys.items(deliveryId!),
    queryFn: () => fetchDeliveryItems(deliveryId!),
    enabled: !!deliveryId,
  })
}

export function useAcceptanceDocs(deliveryId: string | undefined) {
  return useQuery({
    queryKey: deliveryKeys.docs(deliveryId!),
    queryFn: () => fetchAcceptanceDocs(deliveryId!),
    enabled: !!deliveryId,
  })
}
