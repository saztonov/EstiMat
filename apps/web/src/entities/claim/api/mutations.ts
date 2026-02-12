'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ClaimWithRelations, CreateClaimInput, UpdateClaimInput, ApiResponse } from '@estimat/shared'
import { claimKeys } from './queries'

// ============================================================================
// Mutation functions
// ============================================================================

async function createClaim(data: CreateClaimInput): Promise<ClaimWithRelations> {
  const res = await fetch('/api/v1/claims', {
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

async function updateClaim({ id, data }: { id: string; data: UpdateClaimInput }): Promise<ClaimWithRelations> {
  const res = await fetch(`/api/v1/claims/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка обновления рекламации')
  }

  const body: ApiResponse<ClaimWithRelations> = await res.json()
  return body.data!
}

// ============================================================================
// Mutation hooks
// ============================================================================

export function useCreateClaim() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createClaim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: claimKeys.lists() })
    },
  })
}

export function useUpdateClaim() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateClaim,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: claimKeys.lists() })
      queryClient.setQueryData(claimKeys.detail(data.id), data)
    },
  })
}
