'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  PurchaseOrderWithRelations,
  PoItemWithRelations,
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  CreatePoItemInput,
  ApiResponse,
  PoStatus,
} from '@estimat/shared'
import { purchaseOrderKeys } from './queries'

// ============================================================================
// Purchase Order mutation functions
// ============================================================================

async function createPurchaseOrder(data: CreatePurchaseOrderInput): Promise<PurchaseOrderWithRelations> {
  const res = await fetch('/api/v1/purchase-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка создания заказа на закупку')
  }

  const body: ApiResponse<PurchaseOrderWithRelations> = await res.json()
  return body.data!
}

async function updatePurchaseOrder({ id, data }: { id: string; data: UpdatePurchaseOrderInput }): Promise<PurchaseOrderWithRelations> {
  const res = await fetch(`/api/v1/purchase-orders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка обновления заказа на закупку')
  }

  const body: ApiResponse<PurchaseOrderWithRelations> = await res.json()
  return body.data!
}

async function confirmPurchaseOrder(id: string): Promise<PurchaseOrderWithRelations> {
  const res = await fetch(`/api/v1/purchase-orders/${id}/confirm`, {
    method: 'POST',
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка подтверждения заказа')
  }

  const body: ApiResponse<PurchaseOrderWithRelations> = await res.json()
  return body.data!
}

async function updatePurchaseOrderStatus({ id, status }: { id: string; status: PoStatus }): Promise<PurchaseOrderWithRelations> {
  const res = await fetch(`/api/v1/purchase-orders/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка обновления статуса заказа')
  }

  const body: ApiResponse<PurchaseOrderWithRelations> = await res.json()
  return body.data!
}

// ============================================================================
// PO Item mutation functions
// ============================================================================

async function createPoItem(data: CreatePoItemInput): Promise<PoItemWithRelations> {
  const res = await fetch(`/api/v1/purchase-orders/${data.order_id}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка добавления позиции')
  }

  const body: ApiResponse<PoItemWithRelations> = await res.json()
  return body.data!
}

async function updatePoItem({ id, orderId, data }: { id: string; orderId: string; data: Partial<CreatePoItemInput> }): Promise<PoItemWithRelations> {
  const res = await fetch(`/api/v1/purchase-orders/${orderId}/items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка обновления позиции')
  }

  const body: ApiResponse<PoItemWithRelations> = await res.json()
  return body.data!
}

async function deletePoItem({ id, orderId }: { id: string; orderId: string }): Promise<void> {
  const res = await fetch(`/api/v1/purchase-orders/${orderId}/items/${id}`, {
    method: 'DELETE',
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка удаления позиции')
  }
}

// ============================================================================
// Purchase Order mutation hooks
// ============================================================================

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createPurchaseOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lists() })
    },
  })
}

export function useUpdatePurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updatePurchaseOrder,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lists() })
      queryClient.setQueryData(purchaseOrderKeys.detail(data.id), data)
    },
  })
}

export function useConfirmPurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: confirmPurchaseOrder,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lists() })
      queryClient.setQueryData(purchaseOrderKeys.detail(data.id), data)
    },
  })
}

export function useUpdatePurchaseOrderStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updatePurchaseOrderStatus,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.lists() })
      queryClient.setQueryData(purchaseOrderKeys.detail(data.id), data)
    },
  })
}

// ============================================================================
// PO Item mutation hooks
// ============================================================================

export function useCreatePoItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createPoItem,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.items(data.order_id) })
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.detail(data.order_id) })
    },
  })
}

export function useUpdatePoItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updatePoItem,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.items(variables.orderId) })
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.detail(variables.orderId) })
    },
  })
}

export function useDeletePoItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deletePoItem,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.items(variables.orderId) })
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.detail(variables.orderId) })
    },
  })
}
