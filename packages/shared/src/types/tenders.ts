// ============================================================================
// Tender, Tender Lot, Tender Lot Request, and Long-Term Order types
// ============================================================================

import type { BaseEntity, UUID, Timestamp } from "./common";
import type { TenderType, TenderStatus, LtOrderStatus } from "../constants";

export interface Tender extends BaseEntity {
  project_id: UUID | null;
  material_group_id: UUID | null;
  type: TenderType;
  status: TenderStatus;
  period_start: string | null;
  period_end: string | null;
  created_by: UUID;
  notes: string | null;
}

export interface TenderWithRelations extends Tender {
  project?: {
    id: UUID;
    name: string;
  } | null;
  material_group?: {
    id: UUID;
    name: string;
    code: string | null;
  } | null;
  creator?: {
    id: UUID;
    full_name: string;
  } | null;
  lots_count?: number;
}

export interface TenderLot {
  id: UUID;
  tender_id: UUID;
  material_id: UUID;
  total_quantity: number;
  unit: string;
  specifications: Record<string, unknown>;
  created_at: Timestamp;
}

export interface TenderLotWithRelations extends TenderLot {
  material?: {
    id: UUID;
    name: string;
    unit: string;
  } | null;
  requests_count?: number;
  offers?: Array<{
    id: UUID;
    supplier_id: UUID;
    supplier_name?: string;
    amount: number;
    notes?: string;
  }>;
}

export interface TenderLotRequest {
  id: UUID;
  lot_id: UUID;
  pr_item_id: UUID;
}

export interface LongTermOrder extends BaseEntity {
  contract_id: UUID;
  material_id: UUID;
  quantity: number;
  unit: string;
  required_date: string | null;
  status: LtOrderStatus;
  pr_item_id: UUID | null;
  created_by: UUID;
}

export interface LongTermOrderWithRelations extends LongTermOrder {
  contract?: {
    id: UUID;
    number: string;
    supplier_id: UUID;
  } | null;
  material?: {
    id: UUID;
    name: string;
    unit: string;
  } | null;
}

export interface TenderListParams {
  project_id?: UUID;
  material_group_id?: UUID;
  type?: TenderType;
  status?: TenderStatus;
  page?: number;
  limit?: number;
}
