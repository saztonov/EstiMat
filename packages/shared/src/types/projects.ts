// ============================================================================
// Project, ProjectMember, and Site types
// ============================================================================

import type { BaseEntity, UUID, Timestamp } from "./common";
import type { ProjectStatus } from "../constants";

export interface Project extends BaseEntity {
  name: string;
  org_id: UUID;
  address: string | null;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
}

export interface ProjectWithOrg extends Project {
  organization?: {
    id: UUID;
    name: string;
  } | null;
}

export interface ProjectMember {
  id: UUID;
  project_id: UUID;
  user_id: UUID;
  role: string;
}

export interface ProjectMemberWithUser extends ProjectMember {
  user?: {
    id: UUID;
    email: string;
    full_name: string;
  } | null;
}

export interface Site {
  id: UUID;
  project_id: UUID;
  name: string;
  address: string | null;
  created_at: Timestamp;
}

export interface ProjectListParams {
  org_id?: UUID;
  status?: ProjectStatus;
  search?: string;
  page?: number;
  limit?: number;
}
