'use client'

import { useQuery } from '@tanstack/react-query'
import type { ProjectWithOrg, ProjectMemberWithUser } from '../types'

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (params?: { search?: string; status?: string; org_id?: string }) =>
    [...projectKeys.lists(), params] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
  members: (projectId: string) =>
    [...projectKeys.detail(projectId), 'members'] as const,
}

export function useProjects(params?: {
  search?: string
  status?: string
  org_id?: string
}) {
  return useQuery<ProjectWithOrg[]>({
    queryKey: projectKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params?.search) searchParams.set('search', params.search)
      if (params?.status) searchParams.set('status', params.status)
      if (params?.org_id) searchParams.set('org_id', params.org_id)

      const res = await fetch(`/api/v1/projects?${searchParams}`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить проекты')
      }
      const json = await res.json()
      return json.data ?? json
    },
  })
}

export function useProject(id: string) {
  return useQuery<ProjectWithOrg>({
    queryKey: projectKeys.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/v1/projects/${id}`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить проект')
      }
      const json = await res.json()
      return json.data ?? json
    },
    enabled: !!id,
  })
}

export function useProjectMembers(projectId: string) {
  return useQuery<ProjectMemberWithUser[]>({
    queryKey: projectKeys.members(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/projects/${projectId}/members`)
      if (!res.ok) {
        throw new Error('Не удалось загрузить участников проекта')
      }
      const json = await res.json()
      return json.data ?? json
    },
    enabled: !!projectId,
  })
}
