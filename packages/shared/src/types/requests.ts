// ============================================================================
// Purchase Request, PR Item, Distribution Letter, and Advance types
// ============================================================================

import type { BaseEntity, UUID, Timestamp } from "./common";
import type {
  FundingType,
  PrStatus,
  PrItemStatus,
  DistLetterStatus,
  AdvanceStatus,
} from "../constants";

export interface PurchaseRequest extends BaseEntity {
  project_id: UUID;
  estimate_id: UUID;
  contractor_id: UUID;
  funding_type: FundingType;
  status: PrStatus;
  total: number;
  deadline: string | null;
  notes: string | null;
  created_by: UUID;
  approved_by: UUID | null;
  approved_at: Timestamp | null;
}

export interface PurchaseRequestWithRelations extends PurchaseRequest {
  contractor?: {
    id: UUID;
    name: string;
  } | null;
  estimate?: {
    id: UUID;
    work_type: string | null;
    total_amount: number;
  } | null;
  creator?: {
    id: UUID;
    full_name: string;
  } | null;
  items_count?: number;
}

export interface PrItem extends BaseEntity {
  request_id: UUID;
  estimate_item_id: UUID | null;
  material_id: UUID;
  quantity: number;
  unit: string;
  required_date: string | null;
  status: PrItemStatus;
}

export interface PrItemWithRelations extends PrItem {
  material?: {
    id: UUID;
    name: string;
    unit: string;
  } | null;
}

export interface DistributionLetter extends BaseEntity {
  request_id: UUID;
  obs_account: string;
  amount: number;
  payment_date: string | null;
  status: DistLetterStatus;
  approved_by: UUID | null;
  approved_at: Timestamp | null;
  notes: string | null;
  rp_approved_at?: string | null;
  rp_approved_by?: UUID | null;
  obs_approved_at?: string | null;
  obs_approved_by?: UUID | null;
}

export interface Advance extends BaseEntity {
  request_id: UUID;
  contractor_id: UUID;
  amount: number;
  purpose: string | null;
  status: AdvanceStatus;
  approved_by: UUID | null;
  approved_at: Timestamp | null;
  notes: string | null;
  paid_at?: string | null;
  justification?: string | null;
}

export interface AdvanceWithRelations extends Advance {
  contractor?: {
    id: UUID;
    name: string;
  } | null;
}

export interface PurchaseRequestListParams {
  project_id?: UUID;
  contractor_id?: UUID;
  funding_type?: FundingType;
  status?: PrStatus;
  page?: number;
  limit?: number;
}
