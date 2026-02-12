'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Project,
  ProjectMember,
  CreateProjectInput,
  UpdateProjectInput,
  AddProjectMemberInput,
} from '../types'
import { projectKeys } from './queries'

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation<Project, Error, CreateProjectInput>({
    mutationFn: async (data) => {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось создать проект')
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation<Project, Error, { id: string; data: UpdateProjectInput }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/v1/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось обновить проект')
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
      queryClient.invalidateQueries({
        queryKey: projectKeys.detail(variables.id),
      })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/v1/projects/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось удалить проект')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useAddProjectMember() {
  const queryClient = useQueryClient()

  return useMutation<ProjectMember, Error, AddProjectMemberInput>({
    mutationFn: async (data) => {
      const res = await fetch(`/api/v1/projects/${data.project_id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(
          error?.error?.message ?? 'Не удалось добавить участника'
        )
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.members(variables.project_id),
      })
    },
  })
}

export function useRemoveProjectMember() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, { projectId: string; memberId: string }>({
    mutationFn: async ({ projectId, memberId }) => {
      const res = await fetch(
        `/api/v1/projects/${projectId}/members/${memberId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(
          error?.error?.message ?? 'Не удалось удалить участника'
        )
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.members(variables.projectId),
      })
    },
  })
}
