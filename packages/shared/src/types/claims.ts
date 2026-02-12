// ============================================================================
// Claim types
// ============================================================================

import type { BaseEntity, UUID } from "./common";
import type { ClaimType, ClaimStatus } from "../constants";

export interface Claim extends BaseEntity {
  delivery_id: UUID;
  type: ClaimType;
  description: string;
  amount: number | null;
  status: ClaimStatus;
  resolution: string | null;
  created_by: UUID;
}

export interface ClaimWithRelations extends Claim {
  delivery?: {
    id: UUID;
    order_id: UUID;
    project_id: UUID;
    status: string;
  } | null;
  creator?: {
    id: UUID;
    full_name: string;
  } | null;
}

export interface ClaimListParams {
  delivery_id?: UUID;
  type?: ClaimType;
  status?: ClaimStatus;
  page?: number;
  limit?: number;
}
