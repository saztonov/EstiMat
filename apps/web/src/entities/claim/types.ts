import type {
  Claim,
  ClaimWithRelations,
  ClaimListParams,
  ClaimType,
  ClaimStatus,
} from '@estimat/shared'

// ============================================================================
// Claim entity local types
// ============================================================================

export type { Claim, ClaimWithRelations, ClaimListParams }

export interface ClaimFilters extends ClaimListParams {
  sort_by?: string
  sort_direction?: 'asc' | 'desc'
}

/** Labels for claim types in Russian */
export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  quantity: 'Недостача',
  quality: 'Брак',
  damage: 'Повреждение',
  delay: 'Просрочка',
  other: 'Прочее',
}

/** Color variants for claim types */
export const CLAIM_TYPE_COLORS: Record<ClaimType, string> = {
  quantity: 'amber',
  quality: 'red',
  damage: 'red',
  delay: 'blue',
  other: 'gray',
}

/** Labels for claim statuses in Russian */
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  open: 'Открыта',
  in_progress: 'В работе',
  resolved: 'Решена',
  closed: 'Закрыта',
}

/** Color variants for claim statuses */
export const CLAIM_STATUS_COLORS: Record<ClaimStatus, string> = {
  open: 'red',
  in_progress: 'amber',
  resolved: 'green',
  closed: 'gray',
}
