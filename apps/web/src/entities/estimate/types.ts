import type {
  Estimate,
  EstimateWithRelations,
  EstimateItem,
  EstimateItemWithRelations,
  EstimateListParams,
  EstimateStatus,
} from '@estimat/shared'

// Re-export shared types
export type {
  Estimate,
  EstimateWithRelations,
  EstimateItem,
  EstimateItemWithRelations,
  EstimateListParams,
  EstimateStatus,
}

/** Parameters for the estimates list query */
export interface UseEstimatesParams extends Omit<EstimateListParams, 'project_id'> {
  contractor_id?: string
  status?: EstimateStatus
  work_type?: string
  page?: number
  limit?: number
}

/** Payload for creating a new estimate */
export interface CreateEstimatePayload {
  projectId: string
  boq_id: string
  contractor_id?: string | null
  work_type?: string | null
  notes?: string | null
}

/** Payload for updating an estimate */
export interface UpdateEstimatePayload {
  id: string
  contractor_id?: string | null
  work_type?: string | null
  status?: EstimateStatus
  notes?: string | null
}

/** Payload for approving an estimate */
export interface ApproveEstimatePayload {
  id: string
  comment?: string
}

/** Payload for creating an estimate item */
export interface CreateEstimateItemPayload {
  estimateId: string
  boq_item_id?: string | null
  description?: string | null
  quantity: number
  unit: string
  unit_price: number
  sort_order?: number
}

/** Payload for updating an estimate item */
export interface UpdateEstimateItemPayload {
  id: string
  boq_item_id?: string | null
  description?: string | null
  quantity?: number
  unit?: string
  unit_price?: number
  sort_order?: number
}
