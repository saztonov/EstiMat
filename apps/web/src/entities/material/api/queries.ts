'use client'

import { useQuery } from '@tanstack/react-query'
import type { MaterialCatalogWithGroup, MaterialGroup } from '../types'

export const materialKeys = {
  all: ['materials'] as const,
  lists: () => [...materialKeys.all, 'list'] as const,
  list: (params?: { search?: string; group_id?: string }) =>
    [...materialKeys.lists(), params] as const,
  details: () => [...materialKeys.all, 'detail'] as const,
  detail: (id: string) => [...materialKeys.details(), id] as const,
  groups: () => ['material-groups'] as const,
  group: (id: string) => ['material-groups', id] as const,
}

export function useMaterials(params?: {
  search?: string
  group_id?: string
}) {
  return useQuery<MaterialCatalogWithGroup[]>({
    queryKey: materialKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params?.search) searchParams.set('search', params.search)
      if (params?.group_id) searchParams.set('group_id', params.group_id)

      const res = await fetch(`/api/v1/materials?${searchParams}`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить материалы')
      }
      const json = await res.json()
      return json.data ?? json
    },
  })
}

export function useMaterial(id: string) {
  return useQuery<MaterialCatalogWithGroup>({
    queryKey: materialKeys.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/v1/materials/${id}`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить материал')
      }
      const json = await res.json()
      return json.data ?? json
    },
    enabled: !!id,
  })
}

export function useMaterialGroups() {
  return useQuery<MaterialGroup[]>({
    queryKey: materialKeys.groups(),
    queryFn: async () => {
      const res = await fetch('/api/v1/material-groups')
      if (!res.ok) {
        throw new Error('Не удалось загрузить группы материалов')
      }
      const json = await res.json()
      return json.data ?? json
    },
  })
}

export function useMaterialGroup(id: string) {
  return useQuery<MaterialGroup>({
    queryKey: materialKeys.group(id),
    queryFn: async () => {
      const res = await fetch(`/api/v1/material-groups/${id}`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить группу материалов')
      }
      const json = await res.json()
      return json.data ?? json
    },
    enabled: !!id,
  })
}
