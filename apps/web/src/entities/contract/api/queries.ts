'use client'

import { useQuery } from '@tanstack/react-query'
import type { ContractWithRelations, ContractListParams, PaginatedResult, ApiResponse } from '@estimat/shared'

// ============================================================================
// Contract query keys
// ============================================================================

export const contractKeys = {
  all: ['contracts'] as const,
  lists: () => [...contractKeys.all, 'list'] as const,
  list: (params?: ContractListParams) => [...contractKeys.lists(), params] as const,
  details: () => [...contractKeys.all, 'detail'] as const,
  detail: (id: string) => [...contractKeys.details(), id] as const,
}

// ============================================================================
// Fetch functions
// ============================================================================

async function fetchContracts(params?: ContractListParams): Promise<PaginatedResult<ContractWithRelations>> {
  const searchParams = new URLSearchParams()

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value))
      }
    })
  }

  const query = searchParams.toString()
  const url = `/api/v1/contracts${query ? `?${query}` : ''}`

  const res = await fetch(url)
  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки договоров')
  }

  return res.json()
}

async function fetchContract(id: string): Promise<ContractWithRelations> {
  const res = await fetch(`/api/v1/contracts/${id}`)
  if (!res.ok) {
    const error: ApiResponse<never> = await res.json()
    throw new Error(error.error?.message ?? 'Ошибка загрузки договора')
  }

  const body: ApiResponse<ContractWithRelations> = await res.json()
  return body.data!
}

// ============================================================================
// Query hooks
// ============================================================================

export function useContracts(params?: ContractListParams) {
  return useQuery({
    queryKey: contractKeys.list(params),
    queryFn: () => fetchContracts(params),
  })
}

export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: contractKeys.detail(id!),
    queryFn: () => fetchContract(id!),
    enabled: !!id,
  })
}
