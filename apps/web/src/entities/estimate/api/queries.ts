'use client'

import { useQuery } from '@tanstack/react-query'
import type { ApiResponse, PaginatedResult } from '@/shared/types/api'
import type {
  EstimateWithRelations,
  EstimateItemWithRelations,
  UseEstimatesParams,
} from '../types'

/** Query key factory for estimates */
export const estimateKeys = {
  all: ['estimates'] as const,
  lists: () => [...estimateKeys.all, 'list'] as const,
  list: (projectId: string, params?: UseEstimatesParams) =>
    [...estimateKeys.lists(), projectId, params] as const,
  details: () => [...estimateKeys.all, 'detail'] as const,
  detail: (id: string) => [...estimateKeys.details(), id] as const,
  items: (estimateId: string) => [...estimateKeys.all, 'items', estimateId] as const,
}

/** Fetch paginated list of estimates for a project */
async function fetchEstimates(
  projectId: string,
  params?: UseEstimatesParams
): Promise<PaginatedResult<EstimateWithRelations>> {
  const searchParams = new URLSearchParams()

  if (params?.contractor_id) searchParams.set('contractor_id', params.contractor_id)
  if (params?.status) searchParams.set('status', params.status)
  if (params?.work_type) searchParams.set('work_type', params.work_type)
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.limit) searchParams.set('limit', String(params.limit))

  const qs = searchParams.toString()
  const url = `/api/v1/projects/${projectId}/estimates${qs ? `?${qs}` : ''}`

  const res = await fetch(url)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить сметы')
  }

  return res.json()
}

/** Fetch a single estimate by ID */
async function fetchEstimate(id: string): Promise<EstimateWithRelations> {
  const res = await fetch(`/api/v1/estimates/${id}`)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить смету')
  }

  const json: ApiResponse<EstimateWithRelations> = await res.json()
  return json.data!
}

/** Fetch items of an estimate */
async function fetchEstimateItems(estimateId: string): Promise<EstimateItemWithRelations[]> {
  const res = await fetch(`/api/v1/estimates/${estimateId}/items`)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить позиции сметы')
  }

  const json: ApiResponse<EstimateItemWithRelations[]> = await res.json()
  return json.data!
}

/** Hook: paginated list of estimates for a project */
export function useEstimates(projectId: string, params?: UseEstimatesParams) {
  return useQuery({
    queryKey: estimateKeys.list(projectId, params),
    queryFn: () => fetchEstimates(projectId, params),
    enabled: !!projectId,
  })
}

/** Hook: single estimate by ID */
export function useEstimate(id: string) {
  return useQuery({
    queryKey: estimateKeys.detail(id),
    queryFn: () => fetchEstimate(id),
    enabled: !!id,
  })
}

/** Hook: items for an estimate */
export function useEstimateItems(estimateId: string) {
  return useQuery({
    queryKey: estimateKeys.items(estimateId),
    queryFn: () => fetchEstimateItems(estimateId),
    enabled: !!estimateId,
  })
}
