import type {
  Boq,
  BoqWithRelations,
  BoqItem,
  BoqItemWithRelations,
  VolumeCalculation,
  BoqListParams,
  BoqStatus,
} from '@estimat/shared'

// Re-export shared types
export type {
  Boq,
  BoqWithRelations,
  BoqItem,
  BoqItemWithRelations,
  VolumeCalculation,
  BoqListParams,
  BoqStatus,
}

/** Parameters for the BOQ list query */
export interface UseBoqsParams extends Omit<BoqListParams, 'project_id'> {
  status?: BoqStatus
  page?: number
  limit?: number
}

/** Payload for creating a new BOQ */
export interface CreateBoqPayload {
  projectId: string
  version?: number
  notes?: string | null
}

/** Payload for updating a BOQ */
export interface UpdateBoqPayload {
  id: string
  status?: BoqStatus
  notes?: string | null
}

/** Payload for approving a BOQ */
export interface ApproveBoqPayload {
  id: string
  comment?: string
}

/** Payload for creating a BOQ item */
export interface CreateBoqItemPayload {
  boqId: string
  volume_id?: string | null
  material_id?: string | null
  work_type?: string | null
  work_quantity?: number | null
  material_quantity?: number | null
  unit: string
  unit_price?: number | null
  section?: string | null
  sort_order?: number
}

/** Payload for updating a BOQ item */
export interface UpdateBoqItemPayload {
  id: string
  volume_id?: string | null
  material_id?: string | null
  work_type?: string | null
  work_quantity?: number | null
  material_quantity?: number | null
  unit?: string
  unit_price?: number | null
  section?: string | null
  sort_order?: number
}
