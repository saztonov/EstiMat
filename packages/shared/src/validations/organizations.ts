// ============================================================================
// Organization validation schemas
// ============================================================================

import { z } from "zod";
import { ORG_TYPES } from "../constants";

export const createOrganizationSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  inn: z.string().max(12).nullable().optional(),
  type: z.enum(ORG_TYPES),
  contacts: z.record(z.string(), z.string()).optional().default({}),
  address: z.string().max(500).nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
