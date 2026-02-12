'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ContractWithRelations, CreateContractInput, UpdateContractInput, ApiResponse } from '@estimat/shared'
import { contractKeys } from './queries'

// ============================================================================
// Mutation functions
// ============================================================================

async function createContract(data: CreateContractInput): Promise<ContractWithRelations> {
  const res = await fetch('/api/v1/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка создания договора')
  }

  const body: ApiResponse<ContractWithRelations> = await res.json()
  return body.data!
}

async function updateContract({ id, data }: { id: string; data: UpdateContractInput }): Promise<ContractWithRelations> {
  const res = await fetch(`/api/v1/contracts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка обновления договора')
  }

  const body: ApiResponse<ContractWithRelations> = await res.json()
  return body.data!
}

async function deleteContract(id: string): Promise<void> {
  const res = await fetch(`/api/v1/contracts/${id}`, {
    method: 'DELETE',
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка удаления договора')
  }
}

// ============================================================================
// Mutation hooks
// ============================================================================

export function useCreateContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createContract,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.lists() })
    },
  })
}

export function useUpdateContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateContract,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: contractKeys.lists() })
      queryClient.setQueryData(contractKeys.detail(data.id), data)
    },
  })
}

export function useDeleteContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteContract,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.lists() })
    },
  })
}
