// ============================================================================
// RD Volume validation schemas
// ============================================================================

import { z } from "zod";
import { RD_VOLUME_STATUSES } from "../constants";

export const uploadVolumeSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  title: z.string().min(1, "Title is required").max(255),
  code: z.string().max(100).nullable().optional(),
});

export const updateVolumeSchema = z.object({
  title: z.string().min(1, "Title is required").max(255).optional(),
  code: z.string().max(100).nullable().optional(),
  status: z.enum(RD_VOLUME_STATUSES).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UploadVolumeInput = z.infer<typeof uploadVolumeSchema>;
export type UpdateVolumeInput = z.infer<typeof updateVolumeSchema>;
