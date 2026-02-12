// ============================================================================
// Estimate validation schemas
// ============================================================================

import { z } from "zod";
import { ESTIMATE_STATUSES } from "../constants";

export const createEstimateSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  boq_id: z.string().uuid("Invalid BOQ ID"),
  contractor_id: z.string().uuid("Invalid contractor ID").nullable().optional(),
  work_type: z.string().max(255).nullable().optional(),
  status: z.enum(ESTIMATE_STATUSES).optional().default("draft"),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateEstimateSchema = createEstimateSchema.omit({ project_id: true, boq_id: true }).partial();

export const createEstimateItemSchema = z.object({
  estimate_id: z.string().uuid("Invalid estimate ID"),
  boq_item_id: z.string().uuid("Invalid BOQ item ID").nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.string().min(1, "Unit is required").max(50),
  unit_price: z.number().nonnegative("Unit price must be non-negative"),
  sort_order: z.number().int().nonnegative().optional().default(0),
});

export const updateEstimateItemSchema = createEstimateItemSchema
  .omit({ estimate_id: true })
  .partial();

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;
export type CreateEstimateItemInput = z.infer<typeof createEstimateItemSchema>;
export type UpdateEstimateItemInput = z.infer<typeof updateEstimateItemSchema>;
