// ============================================================================
// Claim entity — public API
// ============================================================================

// API: queries
export { useClaims, useClaim, claimKeys } from './api/queries'

// API: mutations
export { useCreateClaim, useUpdateClaim } from './api/mutations'

// Hooks
export { useClaimList, useClaimDetail } from './hooks/use-claims'

// UI
export { ClaimRow, ClaimRowHeader } from './ui/claim-row'
export { ClaimTypeBadge } from './ui/claim-type-badge'

// Types
export type { ClaimFilters } from './types'
export {
  CLAIM_TYPE_LABELS,
  CLAIM_TYPE_COLORS,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_COLORS,
} from './types'
