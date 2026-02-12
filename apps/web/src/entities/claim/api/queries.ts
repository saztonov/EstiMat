'use client'

import { useQuery } from '@tanstack/react-query'
import type { ClaimWithRelations, ClaimListParams, PaginatedResult, ApiResponse } from '@estimat/shared'

// ============================================================================
// Claim query keys
// ============================================================================

export const claimKeys = {
  all: ['claims'] as const,
  lists: () => [...claimKeys.all, 'list'] as const,
  list: (params?: ClaimListParams) => [...claimKeys.lists(), params] as const,
  details: () => [...claimKeys.all, 'detail'] as const,
  detail: (id: string) => [...claimKeys.details(), id] as const,
}

// ============================================================================
// Fetch functions
// ============================================================================

async function fetchClaims(params?: ClaimListParams): Promise<PaginatedResult<ClaimWithRelations>> {
  const searchParams = new URLSearchParams()

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value))
      }
    })
  }

  const query = searchParams.toString()
  const url = `/api/v1/claims${query ? `?${query}` : ''}`

  const res = await fetch(url)
  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки рекламаций')
  }

  return res.json()
}

async function fetchClaim(id: string): Promise<ClaimWithRelations> {
  const res = await fetch(`/api/v1/claims/${id}`)

  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки рекламации')
  }

  const body: ApiResponse<ClaimWithRelations> = await res.json()
  return body.data!
}

// ============================================================================
// Query hooks
// ============================================================================

export function useClaims(params?: ClaimListParams) {
  return useQuery({
    queryKey: claimKeys.list(params),
    queryFn: () => fetchClaims(params),
  })
}

export function useClaim(id: string | undefined) {
  return useQuery({
    queryKey: claimKeys.detail(id!),
    queryFn: () => fetchClaim(id!),
    enabled: !!id,
  })
}
