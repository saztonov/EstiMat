// ============================================================================
// User types
// ============================================================================

import type { BaseEntity, UUID } from "./common";
import type { UserRole } from "../constants";

export interface User extends BaseEntity {
  email: string;
  full_name: string;
  org_id: UUID | null;
  role: UserRole;
  phone: string | null;
  is_active: boolean;
}

export interface UserWithOrg extends User {
  organization?: {
    id: UUID;
    name: string;
    type: string;
  } | null;
}

export interface UserListParams {
  org_id?: UUID;
  role?: UserRole;
  is_active?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}
