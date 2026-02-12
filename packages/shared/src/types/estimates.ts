// ============================================================================
// Estimate types
// ============================================================================

import type { BaseEntity, UUID, Timestamp } from "./common";
import type { EstimateStatus } from "../constants";

export interface Estimate extends BaseEntity {
  project_id: UUID;
  boq_id: UUID;
  contractor_id: UUID | null;
  work_type: string | null;
  status: EstimateStatus;
  total_amount: number;
  created_by: UUID;
  approved_by: UUID | null;
  approved_at: Timestamp | null;
  notes: string | null;
}

export interface EstimateWithRelations extends Estimate {
  contractor?: {
    id: UUID;
    name: string;
  } | null;
  creator?: {
    id: UUID;
    full_name: string;
  } | null;
  boq?: {
    id: UUID;
    version: number;
    status: string;
  } | null;
  items_count?: number;
}

export interface EstimateItem extends BaseEntity {
  estimate_id: UUID;
  boq_item_id: UUID | null;
  description: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  /** Computed: quantity * unit_price */
  total: number;
  sort_order: number;
}

export interface EstimateItemWithRelations extends EstimateItem {
  boq_item?: {
    id: UUID;
    work_type: string | null;
    material_id: UUID | null;
    section: string | null;
  } | null;
  material?: {
    id: UUID;
    name: string;
    unit: string;
  } | null;
}

export interface EstimateListParams {
  project_id?: UUID;
  contractor_id?: UUID;
  status?: EstimateStatus;
  work_type?: string;
  page?: number;
  limit?: number;
}
