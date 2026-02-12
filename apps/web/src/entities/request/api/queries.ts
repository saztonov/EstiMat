'use client'

import { useQuery } from '@tanstack/react-query'
import type { ApiResponse, PaginatedResult } from '@/shared/types/api'
import type {
  PurchaseRequestWithRelations,
  PrItemWithRelations,
  DistributionLetter,
  Advance,
  UseRequestsParams,
} from '../types'

/** Query key factory for purchase requests */
export const requestKeys = {
  all: ['requests'] as const,
  lists: () => [...requestKeys.all, 'list'] as const,
  list: (projectId: string, params?: UseRequestsParams) =>
    [...requestKeys.lists(), projectId, params] as const,
  details: () => [...requestKeys.all, 'detail'] as const,
  detail: (id: string) => [...requestKeys.details(), id] as const,
  items: (requestId: string) => [...requestKeys.all, 'items', requestId] as const,
  distLetter: (requestId: string) =>
    [...requestKeys.all, 'dist-letter', requestId] as const,
  advance: (requestId: string) => [...requestKeys.all, 'advance', requestId] as const,
}

/** Fetch paginated list of purchase requests for a project */
async function fetchRequests(
  projectId: string,
  params?: UseRequestsParams
): Promise<PaginatedResult<PurchaseRequestWithRelations>> {
  const searchParams = new URLSearchParams()

  if (params?.contractor_id) searchParams.set('contractor_id', params.contractor_id)
  if (params?.funding_type) searchParams.set('funding_type', params.funding_type)
  if (params?.status) searchParams.set('status', params.status)
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.limit) searchParams.set('limit', String(params.limit))

  const qs = searchParams.toString()
  const url = `/api/v1/projects/${projectId}/requests${qs ? `?${qs}` : ''}`

  const res = await fetch(url)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить заявки')
  }

  return res.json()
}

/** Fetch a single purchase request by ID */
async function fetchRequest(id: string): Promise<PurchaseRequestWithRelations> {
  const res = await fetch(`/api/v1/requests/${id}`)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить заявку')
  }

  const json: ApiResponse<PurchaseRequestWithRelations> = await res.json()
  return json.data!
}

/** Fetch items of a purchase request */
async function fetchRequestItems(requestId: string): Promise<PrItemWithRelations[]> {
  const res = await fetch(`/api/v1/requests/${requestId}/items`)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить позиции заявки')
  }

  const json: ApiResponse<PrItemWithRelations[]> = await res.json()
  return json.data!
}

/** Fetch distribution letter for a request */
async function fetchDistributionLetter(
  requestId: string
): Promise<DistributionLetter | null> {
  const res = await fetch(`/api/v1/requests/${requestId}/distribution-letter`)
  if (res.status === 404) return null
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить распред. письмо')
  }

  const json: ApiResponse<DistributionLetter> = await res.json()
  return json.data ?? null
}

/** Fetch advance for a request */
async function fetchAdvance(requestId: string): Promise<Advance | null> {
  const res = await fetch(`/api/v1/requests/${requestId}/advance`)
  if (res.status === 404) return null
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить аванс')
  }

  const json: ApiResponse<Advance> = await res.json()
  return json.data ?? null
}

/** Hook: paginated list of purchase requests for a project */
export function useRequests(projectId: string, params?: UseRequestsParams) {
  return useQuery({
    queryKey: requestKeys.list(projectId, params),
    queryFn: () => fetchRequests(projectId, params),
    enabled: !!projectId,
  })
}

/** Hook: single purchase request by ID */
export function useRequest(id: string) {
  return useQuery({
    queryKey: requestKeys.detail(id),
    queryFn: () => fetchRequest(id),
    enabled: !!id,
  })
}

/** Hook: items for a purchase request */
export function useRequestItems(requestId: string) {
  return useQuery({
    queryKey: requestKeys.items(requestId),
    queryFn: () => fetchRequestItems(requestId),
    enabled: !!requestId,
  })
}

/** Hook: distribution letter for a request */
export function useDistributionLetter(requestId: string) {
  return useQuery({
    queryKey: requestKeys.distLetter(requestId),
    queryFn: () => fetchDistributionLetter(requestId),
    enabled: !!requestId,
  })
}

/** Hook: advance for a request */
export function useAdvance(requestId: string) {
  return useQuery({
    queryKey: requestKeys.advance(requestId),
    queryFn: () => fetchAdvance(requestId),
    enabled: !!requestId,
  })
}
