'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  TenderWithRelations,
  LongTermOrderWithRelations,
  CreateTenderInput,
  UpdateTenderInput,
  CreateLongTermOrderInput,
  UpdateLongTermOrderInput,
  ApiResponse,
} from '@estimat/shared'
import { tenderKeys, longTermOrderKeys } from './queries'

// ============================================================================
// Tender mutation functions
// ============================================================================

async function createTender(data: CreateTenderInput): Promise<TenderWithRelations> {
  const res = await fetch('/api/v1/tenders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка создания тендера')
  }

  const body: ApiResponse<TenderWithRelations> = await res.json()
  return body.data!
}

async function updateTender({ id, data }: { id: string; data: UpdateTenderInput }): Promise<TenderWithRelations> {
  const res = await fetch(`/api/v1/tenders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка обновления тендера')
  }

  const body: ApiResponse<TenderWithRelations> = await res.json()
  return body.data!
}

async function publishTender(id: string): Promise<TenderWithRelations> {
  const res = await fetch(`/api/v1/tenders/${id}/publish`, {
    method: 'POST',
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка публикации тендера')
  }

  const body: ApiResponse<TenderWithRelations> = await res.json()
  return body.data!
}

async function awardTender({ id, data }: { id: string; data: Record<string, unknown> }): Promise<TenderWithRelations> {
  const res = await fetch(`/api/v1/tenders/${id}/award`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка определения победителя')
  }

  const body: ApiResponse<TenderWithRelations> = await res.json()
  return body.data!
}

// ============================================================================
// Long-term order mutation functions
// ============================================================================

async function createLongTermOrder(data: CreateLongTermOrderInput): Promise<LongTermOrderWithRelations> {
  const res = await fetch('/api/v1/long-term-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка создания долгосрочного заказа')
  }

  const body: ApiResponse<LongTermOrderWithRelations> = await res.json()
  return body.data!
}

async function updateLongTermOrder({ id, data }: { id: string; data: UpdateLongTermOrderInput }): Promise<LongTermOrderWithRelations> {
  const res = await fetch(`/api/v1/long-term-orders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка обновления долгосрочного заказа')
  }

  const body: ApiResponse<LongTermOrderWithRelations> = await res.json()
  return body.data!
}

// ============================================================================
// Tender mutation hooks
// ============================================================================

export function useCreateTender() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createTender,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenderKeys.lists() })
    },
  })
}

export function useUpdateTender() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateTender,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: tenderKeys.lists() })
      queryClient.setQueryData(tenderKeys.detail(data.id), data)
    },
  })
}

export function usePublishTender() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: publishTender,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: tenderKeys.lists() })
      queryClient.setQueryData(tenderKeys.detail(data.id), data)
    },
  })
}

export function useAwardTender() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: awardTender,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: tenderKeys.lists() })
      queryClient.setQueryData(tenderKeys.detail(data.id), data)
    },
  })
}

// ============================================================================
// Long-term order mutation hooks
// ============================================================================

export function useCreateLongTermOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createLongTermOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: longTermOrderKeys.lists() })
    },
  })
}

export function useUpdateLongTermOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateLongTermOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: longTermOrderKeys.lists() })
    },
  })
}
