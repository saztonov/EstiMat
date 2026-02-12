'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiResponse } from '@/shared/types/api'
import type {
  BoqWithRelations,
  BoqItemWithRelations,
  CreateBoqPayload,
  UpdateBoqPayload,
  ApproveBoqPayload,
  CreateBoqItemPayload,
  UpdateBoqItemPayload,
} from '../types'
import { boqKeys } from './queries'

/** Create a new BOQ */
export function useCreateBoq() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateBoqPayload): Promise<BoqWithRelations> => {
      const { projectId, ...body } = payload

      const res = await fetch(`/api/v1/projects/${projectId}/boq`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось создать ВОР')
      }

      const json: ApiResponse<BoqWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boqKeys.lists() })
    },
  })
}

/** Update a BOQ */
export function useUpdateBoq() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: UpdateBoqPayload): Promise<BoqWithRelations> => {
      const { id, ...body } = payload

      const res = await fetch(`/api/v1/boq/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось обновить ВОР')
      }

      const json: ApiResponse<BoqWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: boqKeys.lists() })
      queryClient.invalidateQueries({ queryKey: boqKeys.detail(variables.id) })
    },
  })
}

/** Approve a BOQ */
export function useApproveBoq() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: ApproveBoqPayload): Promise<BoqWithRelations> => {
      const res = await fetch(`/api/v1/boq/${payload.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: payload.comment }),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось утвердить ВОР')
      }

      const json: ApiResponse<BoqWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: boqKeys.lists() })
      queryClient.invalidateQueries({ queryKey: boqKeys.detail(variables.id) })
    },
  })
}

/** Create a BOQ item */
export function useCreateBoqItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateBoqItemPayload): Promise<BoqItemWithRelations> => {
      const { boqId, ...body } = payload

      const res = await fetch(`/api/v1/boq/${boqId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось добавить позицию ВОР')
      }

      const json: ApiResponse<BoqItemWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: boqKeys.items(variables.boqId) })
      queryClient.invalidateQueries({ queryKey: boqKeys.lists() })
    },
  })
}

/** Update a BOQ item */
export function useUpdateBoqItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: UpdateBoqItemPayload & { boqId: string }
    ): Promise<BoqItemWithRelations> => {
      const { id, boqId: _boqId, ...body } = payload

      const res = await fetch(`/api/v1/boq-items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось обновить позицию ВОР')
      }

      const json: ApiResponse<BoqItemWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: boqKeys.items(variables.boqId) })
    },
  })
}

/** Delete a BOQ item */
export function useDeleteBoqItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { id: string; boqId: string }): Promise<void> => {
      const res = await fetch(`/api/v1/boq-items/${payload.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось удалить позицию ВОР')
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: boqKeys.items(variables.boqId) })
      queryClient.invalidateQueries({ queryKey: boqKeys.lists() })
    },
  })
}
