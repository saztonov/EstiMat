'use client'

import { useQuery } from '@tanstack/react-query'
import type { ApiResponse, PaginatedResult } from '@/shared/types/api'
import type { RdVolumeWithRelations, UseVolumesParams } from '../types'

/** Query key factory for volumes */
export const volumeKeys = {
  all: ['volumes'] as const,
  lists: () => [...volumeKeys.all, 'list'] as const,
  list: (projectId: string, params?: UseVolumesParams) =>
    [...volumeKeys.lists(), projectId, params] as const,
  details: () => [...volumeKeys.all, 'detail'] as const,
  detail: (id: string) => [...volumeKeys.details(), id] as const,
}

/** Fetch paginated list of volumes for a project */
async function fetchVolumes(
  projectId: string,
  params?: UseVolumesParams
): Promise<PaginatedResult<RdVolumeWithRelations>> {
  const searchParams = new URLSearchParams()

  if (params?.status) searchParams.set('status', params.status)
  if (params?.search) searchParams.set('search', params.search)
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.limit) searchParams.set('limit', String(params.limit))

  const qs = searchParams.toString()
  const url = `/api/v1/projects/${projectId}/volumes${qs ? `?${qs}` : ''}`

  const res = await fetch(url)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить тома РД')
  }

  return res.json()
}

/** Fetch a single volume by ID */
async function fetchVolume(id: string): Promise<RdVolumeWithRelations> {
  const res = await fetch(`/api/v1/volumes/${id}`)
  if (!res.ok) {
    const body: ApiResponse<never> = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? 'Не удалось загрузить том РД')
  }

  const json: ApiResponse<RdVolumeWithRelations> = await res.json()
  return json.data!
}

/** Hook: paginated list of volumes for a project */
export function useVolumes(projectId: string, params?: UseVolumesParams) {
  return useQuery({
    queryKey: volumeKeys.list(projectId, params),
    queryFn: () => fetchVolumes(projectId, params),
    enabled: !!projectId,
  })
}

/** Hook: single volume by ID */
export function useVolume(id: string) {
  return useQuery({
    queryKey: volumeKeys.detail(id),
    queryFn: () => fetchVolume(id),
    enabled: !!id,
  })
}
