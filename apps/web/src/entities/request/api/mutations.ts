'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiResponse } from '@/shared/types/api'
import type {
  PurchaseRequestWithRelations,
  PrItemWithRelations,
  DistributionLetter,
  Advance,
  CreateRequestPayload,
  UpdateRequestPayload,
  RequestActionPayload,
  CreateRequestItemPayload,
  UpdateRequestItemPayload,
  ApproveDistLetterPayload,
  ApproveAdvancePayload,
} from '../types'
import { requestKeys } from './queries'

/** Create a new purchase request */
export function useCreateRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: CreateRequestPayload
    ): Promise<PurchaseRequestWithRelations> => {
      const { projectId, ...body } = payload

      const res = await fetch(`/api/v1/projects/${projectId}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось создать заявку')
      }

      const json: ApiResponse<PurchaseRequestWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestKeys.lists() })
    },
  })
}

/** Update a purchase request */
export function useUpdateRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: UpdateRequestPayload
    ): Promise<PurchaseRequestWithRelations> => {
      const { id, ...body } = payload

      const res = await fetch(`/api/v1/requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось обновить заявку')
      }

      const json: ApiResponse<PurchaseRequestWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: requestKeys.lists() })
      queryClient.invalidateQueries({ queryKey: requestKeys.detail(variables.id) })
    },
  })
}

/** Submit a purchase request for review */
export function useSubmitRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: RequestActionPayload
    ): Promise<PurchaseRequestWithRelations> => {
      const res = await fetch(`/api/v1/requests/${payload.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: payload.comment }),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось отправить заявку на рассмотрение')
      }

      const json: ApiResponse<PurchaseRequestWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: requestKeys.lists() })
      queryClient.invalidateQueries({ queryKey: requestKeys.detail(variables.id) })
    },
  })
}

/** Approve a purchase request */
export function useApproveRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: RequestActionPayload
    ): Promise<PurchaseRequestWithRelations> => {
      const res = await fetch(`/api/v1/requests/${payload.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: payload.comment }),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось утвердить заявку')
      }

      const json: ApiResponse<PurchaseRequestWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: requestKeys.lists() })
      queryClient.invalidateQueries({ queryKey: requestKeys.detail(variables.id) })
    },
  })
}

/** Create a PR item */
export function useCreateRequestItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateRequestItemPayload): Promise<PrItemWithRelations> => {
      const { requestId, ...body } = payload

      const res = await fetch(`/api/v1/requests/${requestId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось добавить позицию заявки')
      }

      const json: ApiResponse<PrItemWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: requestKeys.items(variables.requestId) })
      queryClient.invalidateQueries({ queryKey: requestKeys.lists() })
    },
  })
}

/** Update a PR item */
export function useUpdateRequestItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: UpdateRequestItemPayload & { requestId: string }
    ): Promise<PrItemWithRelations> => {
      const { id, requestId: _requestId, ...body } = payload

      const res = await fetch(`/api/v1/pr-items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось обновить позицию заявки')
      }

      const json: ApiResponse<PrItemWithRelations> = await res.json()
      return json.data!
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: requestKeys.items(variables.requestId) })
    },
  })
}

/** Delete a PR item */
export function useDeleteRequestItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { id: string; requestId: string }): Promise<void> => {
      const res = await fetch(`/api/v1/pr-items/${payload.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось удалить позицию заявки')
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: requestKeys.items(variables.requestId) })
      queryClient.invalidateQueries({ queryKey: requestKeys.lists() })
    },
  })
}

/** Approve a distribution letter */
export function useApproveDistLetter() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: ApproveDistLetterPayload): Promise<DistributionLetter> => {
      const res = await fetch(`/api/v1/distribution-letters/${payload.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: payload.comment }),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось утвердить распред. письмо')
      }

      const json: ApiResponse<DistributionLetter> = await res.json()
      return json.data!
    },
    onSuccess: () => {
      // Invalidate all dist-letter queries since we don't know the requestId here
      queryClient.invalidateQueries({
        queryKey: [...requestKeys.all, 'dist-letter'],
      })
      queryClient.invalidateQueries({ queryKey: requestKeys.lists() })
    },
  })
}

/** Approve an advance */
export function useApproveAdvance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: ApproveAdvancePayload): Promise<Advance> => {
      const res = await fetch(`/api/v1/advances/${payload.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: payload.comment }),
      })

      if (!res.ok) {
        const json: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(json.error?.message ?? 'Не удалось утвердить аванс')
      }

      const json: ApiResponse<Advance> = await res.json()
      return json.data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...requestKeys.all, 'advance'],
      })
      queryClient.invalidateQueries({ queryKey: requestKeys.lists() })
    },
  })
}
