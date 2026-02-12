import type {
  Contract,
  ContractWithRelations,
  ContractListParams,
  ContractStatus,
} from '@estimat/shared'

// ============================================================================
// Contract entity local types
// ============================================================================

export type { Contract, ContractWithRelations, ContractListParams }

export interface ContractFilters extends ContractListParams {
  sort_by?: string
  sort_direction?: 'asc' | 'desc'
}

/** Labels for contract statuses in Russian */
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Черновик',
  active: 'Действующий',
  expired: 'Истёк',
  terminated: 'Расторгнут',
}

/** Color variants for contract statuses */
export const CONTRACT_STATUS_COLORS: Record<ContractStatus, string> = {
  draft: 'amber',
  active: 'green',
  expired: 'gray',
  terminated: 'red',
}
