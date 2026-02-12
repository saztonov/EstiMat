// ============================================================================
// Claim validation schemas
// ============================================================================

import { z } from "zod";
import { CLAIM_TYPES, CLAIM_STATUSES } from "../constants";

export const createClaimSchema = z.object({
  delivery_id: z.string().uuid("Invalid delivery ID"),
  type: z.enum(CLAIM_TYPES),
  description: z.string().min(1, "Description is required").max(5000),
  amount: z.number().nonnegative("Amount must be non-negative").nullable().optional(),
  status: z.enum(CLAIM_STATUSES).optional().default("open"),
  resolution: z.string().max(5000).nullable().optional(),
});

export const updateClaimSchema = createClaimSchema
  .omit({ delivery_id: true })
  .partial();

export type CreateClaimInput = z.infer<typeof createClaimSchema>;
export type UpdateClaimInput = z.infer<typeof updateClaimSchema>;
