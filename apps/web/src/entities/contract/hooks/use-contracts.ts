'use client'

import { useMemo } from 'react'
import { useContracts, useContract } from '../api/queries'
import { useCreateContract, useUpdateContract, useDeleteContract } from '../api/mutations'
import type { ContractListParams } from '@estimat/shared'

/**
 * Composable hook that combines contract queries and mutations
 * for convenient usage in widgets and features.
 */
export function useContractList(params?: ContractListParams) {
  const contractsQuery = useContracts(params)
  const createMutation = useCreateContract()
  const updateMutation = useUpdateContract()
  const deleteMutation = useDeleteContract()

  const isLoading = contractsQuery.isLoading
  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  const contracts = useMemo(
    () => contractsQuery.data?.data ?? [],
    [contractsQuery.data]
  )

  const total = contractsQuery.data?.total ?? 0

  return {
    // Data
    contracts,
    total,

    // Query state
    isLoading,
    isError: contractsQuery.isError,
    error: contractsQuery.error,
    refetch: contractsQuery.refetch,

    // Mutations
    createContract: createMutation.mutateAsync,
    updateContract: updateMutation.mutateAsync,
    deleteContract: deleteMutation.mutateAsync,
    isMutating,
  }
}

export function useContractDetail(id: string | undefined) {
  const contractQuery = useContract(id)
  const updateMutation = useUpdateContract()
  const deleteMutation = useDeleteContract()

  return {
    contract: contractQuery.data,
    isLoading: contractQuery.isLoading,
    isError: contractQuery.isError,
    error: contractQuery.error,
    refetch: contractQuery.refetch,

    updateContract: updateMutation.mutateAsync,
    deleteContract: deleteMutation.mutateAsync,
    isMutating: updateMutation.isPending || deleteMutation.isPending,
  }
}
