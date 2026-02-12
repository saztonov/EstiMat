import type {
  RdVolume,
  RdVolumeWithRelations,
  VolumeListParams,
  RdVolumeStatus,
} from '@estimat/shared'

// Re-export shared types for convenience within the entity layer
export type { RdVolume, RdVolumeWithRelations, VolumeListParams, RdVolumeStatus }

/** Parameters for the volumes list query (extends VolumeListParams with optional overrides) */
export interface UseVolumesParams extends Omit<VolumeListParams, 'project_id'> {
  status?: RdVolumeStatus
  search?: string
  page?: number
  limit?: number
}

/** Payload for creating a new volume (multipart) */
export interface CreateVolumePayload {
  projectId: string
  title: string
  code?: string | null
  file: File
}

/** Payload for updating an existing volume */
export interface UpdateVolumePayload {
  id: string
  title?: string
  code?: string | null
  metadata?: Record<string, unknown>
}

/** Payload for verify / approve actions */
export interface VolumeActionPayload {
  id: string
  comment?: string
}
