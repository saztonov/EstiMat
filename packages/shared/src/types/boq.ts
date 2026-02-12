// ============================================================================
// BOQ (Bill of Quantities) types
// ============================================================================

import type { BaseEntity, UUID, Timestamp } from "./common";
import type { BoqStatus } from "../constants";

export interface Boq extends BaseEntity {
  project_id: UUID;
  version: number;
  status: BoqStatus;
  created_by: UUID;
  approved_by: UUID | null;
  approved_at: Timestamp | null;
  notes: string | null;
}

export interface BoqWithRelations extends Boq {
  creator?: {
    id: UUID;
    full_name: string;
  } | null;
  approver?: {
    id: UUID;
    full_name: string;
  } | null;
  items_count?: number;
}

export interface BoqItem extends BaseEntity {
  boq_id: UUID;
  volume_id: UUID | null;
  material_id: UUID | null;
  work_type: string | null;
  work_quantity: number | null;
  material_quantity: number | null;
  unit: string;
  unit_price: number | null;
  /** Computed: material_quantity * unit_price */
  total: number | null;
  raw_text: string | null;
  ai_confidence: number | null;
  section: string | null;
  sort_order: number;
}

export interface BoqItemWithRelations extends BoqItem {
  material?: {
    id: UUID;
    name: string;
    unit: string;
  } | null;
  volume?: {
    id: UUID;
    title: string;
    code: string | null;
  } | null;
}

export interface VolumeCalculation extends BaseEntity {
  boq_item_id: UUID;
  calculated_qty: number;
  unit: string;
  coefficient: number;
  method: string | null;
  notes: string | null;
  calculated_by: UUID;
}

export interface VolumeCalculationWithUser extends VolumeCalculation {
  calculator?: {
    id: UUID;
    full_name: string;
  } | null;
}

export interface BoqListParams {
  project_id?: UUID;
  status?: BoqStatus;
  page?: number;
  limit?: number;
}
