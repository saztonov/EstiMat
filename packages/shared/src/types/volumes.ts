// ============================================================================
// RD Volume (design documentation) types
// ============================================================================

import type { BaseEntity, UUID, Timestamp } from "./common";
import type { RdVolumeStatus } from "../constants";

export interface RdVolume extends BaseEntity {
  project_id: UUID;
  title: string;
  code: string | null;
  version: number;
  status: RdVolumeStatus;
  file_path: string;
  file_size_bytes: number | null;
  uploaded_by: UUID;
  verified_by: UUID | null;
  uploaded_at: Timestamp;
  verified_at: Timestamp | null;
  metadata: Record<string, unknown>;
}

export interface RdVolumeWithRelations extends RdVolume {
  uploader?: {
    id: UUID;
    full_name: string;
  } | null;
  verifier?: {
    id: UUID;
    full_name: string;
  } | null;
}

export interface VolumeListParams {
  project_id?: UUID;
  status?: RdVolumeStatus;
  search?: string;
  page?: number;
  limit?: number;
}
