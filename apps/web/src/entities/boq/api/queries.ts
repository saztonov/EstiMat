'use client'

import { useQuery } from '@tanstack/react-query'
import type { ApiResponse, PaginatedResult } from '@/shared/types/api'
import type { BoqWithRelations, BoqItemWithRelations, UseBoqsParams } from '../types'

/** Query key factory for BOQ */
export const boqKeys = {
  all: ['boq'] as const,
  lists: () => [...boqKeys.all, 'list'] as const,
  list: (projectId: string, params?: UseBoqsParams) =>
    [...boqKeys.lists(), projectId, params] as const,
  details: () => [...boqKeys.all, 'detail'] as const,
  detail: (id: string) => [...boqKeys.details(), id] as const,
  items: (boqId: string) => [...boqKeys.all, 'items', boqId] as const,
}

/** Fetch paginated list of BOQs for a project */
async function fetchBoqs(
  projectId: string,
  params?: UseBoqsParams
): Promise<PaginatedResult<BoqWithRelations>> {
  const searchParams = new URLSearchParams()

  if (params?.status) searchParams.set('status', params.status)
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.limit) searchParams.set('limit', String(params.limit))

  const qs = searchParams.toString()
  const url = `/api/v1/projects/${projectId}/boq${qs ? `?${qs}` : ''}`

  const res = await fetch(url)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить ведомости объёмов')
  }

  return res.json()
}

/** Fetch a single BOQ by ID */
async function fetchBoq(id: string): Promise<BoqWithRelations> {
  const res = await fetch(`/api/v1/boq/${id}`)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить ВОР')
  }

  const json: ApiResponse<BoqWithRelations> = await res.json()
  return json.data!
}

/** Fetch items of a BOQ */
async function fetchBoqItems(boqId: string): Promise<BoqItemWithRelations[]> {
  const res = await fetch(`/api/v1/boq/${boqId}/items`)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить позиции ВОР')
  }

  const json: ApiResponse<BoqItemWithRelations[]> = await res.json()
  return json.data!
}

/** Hook: paginated list of BOQs for a project */
export function useBoqs(projectId: string, params?: UseBoqsParams) {
  return useQuery({
    queryKey: boqKeys.list(projectId, params),
    queryFn: () => fetchBoqs(projectId, params),
    enabled: !!projectId,
  })
}

/** Hook: single BOQ by ID */
export function useBoq(id: string) {
  return useQuery({
    queryKey: boqKeys.detail(id),
    queryFn: () => fetchBoq(id),
    enabled: !!id,
  })
}

/** Hook: items for a BOQ */
export function useBoqItems(boqId: string) {
  return useQuery({
    queryKey: boqKeys.items(boqId),
    queryFn: () => fetchBoqItems(boqId),
    enabled: !!boqId,
  })
}
