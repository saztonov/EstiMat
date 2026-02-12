'use client'

import { useMemo } from 'react'
import { useClaims, useClaim } from '../api/queries'
import { useCreateClaim, useUpdateClaim } from '../api/mutations'
import type { ClaimListParams } from '@estimat/shared'

/**
 * Composable hook that combines claim queries and mutations
 * for convenient usage in widgets and features.
 */
export function useClaimList(params?: ClaimListParams) {
  const claimsQuery = useClaims(params)
  const createMutation = useCreateClaim()
  const updateMutation = useUpdateClaim()

  const isLoading = claimsQuery.isLoading
  const isMutating = createMutation.isPending || updateMutation.isPending

  const claims = useMemo(
    () => claimsQuery.data?.data ?? [],
    [claimsQuery.data]
  )

  const total = claimsQuery.data?.total ?? 0

  return {
    claims,
    total,
    isLoading,
    isError: claimsQuery.isError,
    error: claimsQuery.error,
    refetch: claimsQuery.refetch,

    createClaim: createMutation.mutateAsync,
    updateClaim: updateMutation.mutateAsync,
    isMutating,
  }
}

export function useClaimDetail(id: string | undefined) {
  const claimQuery = useClaim(id)
  const updateMutation = useUpdateClaim()

  return {
    claim: claimQuery.data,
    isLoading: claimQuery.isLoading,
    isError: claimQuery.isError,
    error: claimQuery.error,
    refetch: claimQuery.refetch,

    updateClaim: updateMutation.mutateAsync,
    isMutating: updateMutation.isPending,
  }
}
