import type {
  PurchaseRequest,
  PurchaseRequestWithRelations,
  PrItem,
  PrItemWithRelations,
  DistributionLetter,
  Advance,
  AdvanceWithRelations,
  PurchaseRequestListParams,
  PrStatus,
  PrItemStatus,
  FundingType,
  DistLetterStatus,
  AdvanceStatus,
} from '@estimat/shared'

// Re-export shared types
export type {
  PurchaseRequest,
  PurchaseRequestWithRelations,
  PrItem,
  PrItemWithRelations,
  DistributionLetter,
  Advance,
  AdvanceWithRelations,
  PurchaseRequestListParams,
  PrStatus,
  PrItemStatus,
  FundingType,
  DistLetterStatus,
  AdvanceStatus,
}

/** Parameters for the requests list query */
export interface UseRequestsParams extends Omit<PurchaseRequestListParams, 'project_id'> {
  contractor_id?: string
  funding_type?: FundingType
  status?: PrStatus
  page?: number
  limit?: number
}

/** Payload for creating a new purchase request */
export interface CreateRequestPayload {
  projectId: string
  estimate_id: string
  contractor_id: string
  funding_type: FundingType
  deadline?: string | null
  notes?: string | null
}

/** Payload for updating a purchase request */
export interface UpdateRequestPayload {
  id: string
  status?: PrStatus
  deadline?: string | null
  notes?: string | null
}

/** Payload for submit / approve actions */
export interface RequestActionPayload {
  id: string
  comment?: string
}

/** Payload for creating a PR item */
export interface CreateRequestItemPayload {
  requestId: string
  estimate_item_id?: string | null
  material_id: string
  quantity: number
  unit: string
  required_date?: string | null
}

/** Payload for updating a PR item */
export interface UpdateRequestItemPayload {
  id: string
  estimate_item_id?: string | null
  material_id?: string
  quantity?: number
  unit?: string
  required_date?: string | null
  status?: PrItemStatus
}

/** Payload for approving a distribution letter */
export interface ApproveDistLetterPayload {
  id: string
  comment?: string
}

/** Payload for approving an advance */
export interface ApproveAdvancePayload {
  id: string
  comment?: string
}
