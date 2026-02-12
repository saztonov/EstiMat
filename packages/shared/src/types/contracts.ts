// ============================================================================
// Contract types
// ============================================================================

import type { BaseEntity, UUID } from "./common";
import type { ContractStatus } from "../constants";

export interface Contract extends BaseEntity {
  supplier_id: UUID;
  project_id: UUID | null;
  number: string;
  date: string;
  valid_until: string | null;
  terms: Record<string, unknown>;
  status: ContractStatus;
  total_amount: number | null;
}

export interface ContractWithRelations extends Contract {
  supplier?: {
    id: UUID;
    name: string;
  } | null;
  project?: {
    id: UUID;
    name: string;
  } | null;
  name?: string;
  counterparty?: { id: UUID; name: string } | null;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
}

export interface ContractListParams {
  supplier_id?: UUID;
  project_id?: UUID;
  status?: ContractStatus;
  search?: string;
  page?: number;
  limit?: number;
}
