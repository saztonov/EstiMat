'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiResponse } from '@/shared/types/api'
import type {
  RdVolumeWithRelations,
  CreateVolumePayload,
  UpdateVolumePayload,
  VolumeActionPayload,
} from '../types'
import { volumeKeys } from './queries'

/** Create a new volume (multipart/form-data for file upload) */
export function useCreateVolume() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateVolumePayload): Promise<RdVolumeWithRelations> => {
      const formData = new FormData()
      formData.append('title', payload.title)
      if (payload.code) formData.append('code', payload.code)
      formData.append('file', payload.file)

      const res = await fetch(`/api/v1/projects/${payload.projectId}/volumes`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const body: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(body.error?.message ?? 'Не удалось создать том РД')
      }

      const json: ApiResponse<RdVolumeWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: volumeKeys.lists() })
    },
  })
}

/** Update an existing volume */
export function useUpdateVolume() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: UpdateVolumePayload): Promise<RdVolumeWithRelations> => {
      const { id, ...body } = payload

      const res = await fetch(`/api/v1/volumes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось обновить том РД')
      }

      const json: ApiResponse<RdVolumeWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: volumeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: volumeKeys.detail(variables.id) })
    },
  })
}

/** Verify a volume (marks as checked by engineer) */
export function useVerifyVolume() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: VolumeActionPayload): Promise<RdVolumeWithRelations> => {
      const res = await fetch(`/api/v1/volumes/${payload.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: payload.comment }),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось верифицировать том РД')
      }

      const json: ApiResponse<RdVolumeWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: volumeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: volumeKeys.detail(variables.id) })
    },
  })
}

/** Approve a volume (final approval) */
export function useApproveVolume() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: VolumeActionPayload): Promise<RdVolumeWithRelations> => {
      const res = await fetch(`/api/v1/volumes/${payload.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: payload.comment }),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось утвердить том РД')
      }

      const json: ApiResponse<RdVolumeWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: volumeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: volumeKeys.detail(variables.id) })
    },
  })
}
