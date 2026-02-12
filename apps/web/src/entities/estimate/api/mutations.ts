'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiResponse } from '@/shared/types/api'
import type {
  EstimateWithRelations,
  EstimateItemWithRelations,
  CreateEstimatePayload,
  UpdateEstimatePayload,
  ApproveEstimatePayload,
  CreateEstimateItemPayload,
  UpdateEstimateItemPayload,
} from '../types'
import { estimateKeys } from './queries'

/** Create a new estimate */
export function useCreateEstimate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateEstimatePayload): Promise<EstimateWithRelations> => {
      const { projectId, ...body } = payload

      const res = await fetch(`/api/v1/projects/${projectId}/estimates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось создать смету')
      }

      const json: ApiResponse<EstimateWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: estimateKeys.lists() })
    },
  })
}

/** Update an estimate */
export function useUpdateEstimate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: UpdateEstimatePayload): Promise<EstimateWithRelations> => {
      const { id, ...body } = payload

      const res = await fetch(`/api/v1/estimates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось обновить смету')
      }

      const json: ApiResponse<EstimateWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: estimateKeys.lists() })
      queryClient.invalidateQueries({ queryKey: estimateKeys.detail(variables.id) })
    },
  })
}

/** Approve an estimate */
export function useApproveEstimate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: ApproveEstimatePayload): Promise<EstimateWithRelations> => {
      const res = await fetch(`/api/v1/estimates/${payload.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: payload.comment }),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось утвердить смету')
      }

      const json: ApiResponse<EstimateWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: estimateKeys.lists() })
      queryClient.invalidateQueries({ queryKey: estimateKeys.detail(variables.id) })
    },
  })
}

/** Create an estimate item */
export function useCreateEstimateItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: CreateEstimateItemPayload
    ): Promise<EstimateItemWithRelations> => {
      const { estimateId, ...body } = payload

      const res = await fetch(`/api/v1/estimates/${estimateId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось добавить позицию сметы')
      }

      const json: ApiResponse<EstimateItemWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: estimateKeys.items(variables.estimateId) })
      queryClient.invalidateQueries({ queryKey: estimateKeys.lists() })
    },
  })
}

/** Update an estimate item */
export function useUpdateEstimateItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: UpdateEstimateItemPayload & { estimateId: string }
    ): Promise<EstimateItemWithRelations> => {
      const { id, estimateId: _estimateId, ...body } = payload

      const res = await fetch(`/api/v1/estimate-items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось обновить позицию сметы')
      }

      const json: ApiResponse<EstimateItemWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: estimateKeys.items(variables.estimateId) })
    },
  })
}

/** Delete an estimate item */
export function useDeleteEstimateItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { id: string; estimateId: string }): Promise<void> => {
      const res = await fetch(`/api/v1/estimate-items/${payload.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось удалить позицию сметы')
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: estimateKeys.items(variables.estimateId) })
      queryClient.invalidateQueries({ queryKey: estimateKeys.lists() })
    },
  })
}
