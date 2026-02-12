// ============================================================================
// Organization types
// ============================================================================

import type { BaseEntity, UUID } from "./common";
import type { OrgType } from "../constants";

export interface Organization extends BaseEntity {
  name: string;
  inn: string | null;
  type: OrgType;
  contacts: Record<string, string>;
  address: string | null;
  is_active: boolean;
}

export interface OrganizationWithStats extends Organization {
  projects_count?: number;
  users_count?: number;
}

export interface OrganizationListParams {
  type?: OrgType;
  is_active?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}
