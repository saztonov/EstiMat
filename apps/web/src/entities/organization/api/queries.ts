'use client'

import { useQuery } from '@tanstack/react-query'
import type { Organization, OrganizationWithStats } from '../types'

export const organizationKeys = {
  all: ['organizations'] as const,
  lists: () => [...organizationKeys.all, 'list'] as const,
  list: (params?: { search?: string; type?: string }) =>
    [...organizationKeys.lists(), params] as const,
  details: () => [...organizationKeys.all, 'detail'] as const,
  detail: (id: string) => [...organizationKeys.details(), id] as const,
}

export function useOrganizations(params?: { search?: string; type?: string }) {
  return useQuery<OrganizationWithStats[]>({
    queryKey: organizationKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params?.search) searchParams.set('search', params.search)
      if (params?.type) searchParams.set('type', params.type)

      const res = await fetch(`/api/v1/organizations?${searchParams}`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить организации')
      }
      const json = await res.json()
      return json.data ?? json
    },
  })
}

export function useOrganization(id: string) {
  return useQuery<Organization>({
    queryKey: organizationKeys.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${id}`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить организацию')
      }
      const json = await res.json()
      return json.data ?? json
    },
    enabled: !!id,
  })
}
