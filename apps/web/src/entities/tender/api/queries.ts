'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  TenderWithRelations,
  TenderLotWithRelations,
  LongTermOrderWithRelations,
  TenderListParams,
  PaginatedResult,
  ApiResponse,
} from '@estimat/shared'
import type { LongTermOrderListParams } from '../types'

// ============================================================================
// Tender query keys
// ============================================================================

export const tenderKeys = {
  all: ['tenders'] as const,
  lists: () => [...tenderKeys.all, 'list'] as const,
  list: (params?: TenderListParams) => [...tenderKeys.lists(), params] as const,
  details: () => [...tenderKeys.all, 'detail'] as const,
  detail: (id: string) => [...tenderKeys.details(), id] as const,
  lots: (tenderId: string) => [...tenderKeys.all, 'lots', tenderId] as const,
}

export const longTermOrderKeys = {
  all: ['long-term-orders'] as const,
  lists: () => [...longTermOrderKeys.all, 'list'] as const,
  list: (params?: LongTermOrderListParams) => [...longTermOrderKeys.lists(), params] as const,
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

async function fetchTenders(params?: TenderListParams): Promise<PaginatedResult<TenderWithRelations>> {
  const url = `/api/v1/tenders${buildSearchParams(params as Record<string, unknown>)}`
  const res = await fetch(url)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки тендеров')
  }

  return res.json()
}

async function fetchTender(id: string): Promise<TenderWithRelations> {
  const res = await fetch(`/api/v1/tenders/${id}`)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки тендера')
  }

  const body: ApiResponse<TenderWithRelations> = await res.json()
  return body.data!
}

async function fetchTenderLots(tenderId: string): Promise<TenderLotWithRelations[]> {
  const res = await fetch(`/api/v1/tenders/${tenderId}/lots`)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки лотов')
  }

  const body: ApiResponse<TenderLotWithRelations[]> = await res.json()
  return body.data!
}

async function fetchLongTermOrders(params?: LongTermOrderListParams): Promise<PaginatedResult<LongTermOrderWithRelations>> {
  const url = `/api/v1/long-term-orders${buildSearchParams(params as Record<string, unknown>)}`
  const res = await fetch(url)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки долгосрочных заказов')
  }

  return res.json()
}

// ============================================================================
// Query hooks
// ============================================================================

export function useTenders(params?: TenderListParams) {
  return useQuery({
    queryKey: tenderKeys.list(params),
    queryFn: () => fetchTenders(params),
  })
}

export function useTender(id: string | undefined) {
  return useQuery({
    queryKey: tenderKeys.detail(id!),
    queryFn: () => fetchTender(id!),
    enabled: !!id,
  })
}

export function useTenderLots(tenderId: string | undefined) {
  return useQuery({
    queryKey: tenderKeys.lots(tenderId!),
    queryFn: () => fetchTenderLots(tenderId!),
    enabled: !!tenderId,
  })
}

export function useLongTermOrders(params?: LongTermOrderListParams) {
  return useQuery({
    queryKey: longTermOrderKeys.list(params),
    queryFn: () => fetchLongTermOrders(params),
  })
}
