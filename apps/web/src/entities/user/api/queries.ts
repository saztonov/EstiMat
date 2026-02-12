'use client'

import { useQuery } from '@tanstack/react-query'
import type { User, UserWithOrg } from '../types'

export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (params?: { search?: string; role?: string; org_id?: string }) =>
    [...userKeys.lists(), params] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
  me: () => [...userKeys.all, 'me'] as const,
}

export function useUsers(params?: {
  search?: string
  role?: string
  org_id?: string
}) {
  return useQuery<UserWithOrg[]>({
    queryKey: userKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params?.search) searchParams.set('search', params.search)
      if (params?.role) searchParams.set('role', params.role)
      if (params?.org_id) searchParams.set('org_id', params.org_id)

      const res = await fetch(`/api/v1/users?${searchParams}`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить пользователей')
      }
      const json = await res.json()
      return json.data ?? json
    },
  })
}

export function useUser(id: string) {
  return useQuery<UserWithOrg>({
    queryKey: userKeys.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/v1/users/${id}`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить пользователя')
      }
      const json = await res.json()
      return json.data ?? json
    },
    enabled: !!id,
  })
}

export function useCurrentUser() {
  return useQuery<User>({
    queryKey: userKeys.me(),
    queryFn: async () => {
      const res = await fetch('/api/v1/users/me')
      if (!res.ok) {
        throw new Error('Не удалось загрузить текущего пользователя')
      }
      const json = await res.json()
      return json.data ?? json
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  })
}
