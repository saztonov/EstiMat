// ============================================================================
// Contract entity — public API
// ============================================================================

// API: queries
export { useContracts, useContract, contractKeys } from './api/queries'

// API: mutations
export { useCreateContract, useUpdateContract, useDeleteContract } from './api/mutations'

// Hooks
export { useContractList, useContractDetail } from './hooks/use-contracts'

// UI
export { ContractRow, ContractRowHeader } from './ui/contract-row'
export { ContractStatusBadge } from './ui/contract-status-badge'

// Types
export type { ContractFilters } from './types'
export { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_COLORS } from './types'
