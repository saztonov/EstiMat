'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  DeliveryWithRelations,
  AcceptanceDoc,
  MaterialTransfer,
  MaterialSale,
  MaterialWriteoff,
  CreateDeliveryInput,
  UpdateDeliveryInput,
  AcceptDeliveryInput,
  CreateAcceptanceDocInput,
  CreateTransferInput,
  CreateSaleInput,
  CreateWriteoffInput,
  CreateClaimInput,
  ApiResponse,
} from '@estimat/shared'
import type { ClaimWithRelations } from '@estimat/shared'
import { deliveryKeys } from './queries'

// ============================================================================
// Delivery mutation functions
// ============================================================================

async function createDelivery(data: CreateDeliveryInput): Promise<DeliveryWithRelations> {
  const res = await fetch('/api/v1/deliveries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка создания поставки')
  }

  const body: ApiResponse<DeliveryWithRelations> = await res.json()
  return body.data!
}

async function updateDelivery({ id, data }: { id: string; data: UpdateDeliveryInput }): Promise<DeliveryWithRelations> {
  const res = await fetch(`/api/v1/deliveries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка обновления поставки')
  }

  const body: ApiResponse<DeliveryWithRelations> = await res.json()
  return body.data!
}

async function acceptDelivery({ id, data }: { id: string; data: AcceptDeliveryInput }): Promise<DeliveryWithRelations> {
  const res = await fetch(`/api/v1/deliveries/${id}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка приёмки поставки')
  }

  const body: ApiResponse<DeliveryWithRelations> = await res.json()
  return body.data!
}

async function uploadAcceptanceDoc({ deliveryId, data }: { deliveryId: string; data: CreateAcceptanceDocInput }): Promise<AcceptanceDoc> {
  const res = await fetch(`/api/v1/deliveries/${deliveryId}/docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки документа')
  }

  const body: ApiResponse<AcceptanceDoc> = await res.json()
  return body.data!
}

async function createTransfer({ deliveryId, data }: { deliveryId: string; data: CreateTransferInput }): Promise<MaterialTransfer> {
  const res = await fetch(`/api/v1/deliveries/${deliveryId}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка создания передачи материалов')
  }

  const body: ApiResponse<MaterialTransfer> = await res.json()
  return body.data!
}

async function createSale({ deliveryId, data }: { deliveryId: string; data: CreateSaleInput }): Promise<MaterialSale> {
  const res = await fetch(`/api/v1/deliveries/${deliveryId}/sale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка создания продажи')
  }

  const body: ApiResponse<MaterialSale> = await res.json()
  return body.data!
}

async function createWriteoff({ deliveryId, data }: { deliveryId: string; data: CreateWriteoffInput }): Promise<MaterialWriteoff> {
  const res = await fetch(`/api/v1/deliveries/${deliveryId}/writeoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка создания списания')
  }

  const body: ApiResponse<MaterialWriteoff> = await res.json()
  return body.data!
}

async function createClaimFromDelivery({ deliveryId, data }: { deliveryId: string; data: CreateClaimInput }): Promise<ClaimWithRelations> {
  const res = await fetch(`/api/v1/deliveries/${deliveryId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка создания рекламации')
  }

  const body: ApiResponse<ClaimWithRelations> = await res.json()
  return body.data!
}

// ============================================================================
// Delivery mutation hooks
// ============================================================================

export function useCreateDelivery() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createDelivery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.lists() })
    },
  })
}

export function useUpdateDelivery() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateDelivery,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.lists() })
      queryClient.setQueryData(deliveryKeys.detail(data.id), data)
    },
  })
}

export function useAcceptDelivery() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: acceptDelivery,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.lists() })
      queryClient.setQueryData(deliveryKeys.detail(data.id), data)
      queryClient.invalidateQueries({ queryKey: deliveryKeys.items(data.id) })
    },
  })
}

export function useUploadAcceptanceDoc() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: uploadAcceptanceDoc,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.docs(variables.deliveryId) })
    },
  })
}

export function useCreateTransfer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createTransfer,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(variables.deliveryId) })
    },
  })
}

export function useCreateSale() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createSale,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(variables.deliveryId) })
    },
  })
}

export function useCreateWriteoff() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createWriteoff,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(variables.deliveryId) })
    },
  })
}

export function useCreateClaim() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createClaimFromDelivery,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(variables.deliveryId) })
      // Also invalidate claims list if it is cached
      queryClient.invalidateQueries({ queryKey: ['claims'] })
    },
  })
}
