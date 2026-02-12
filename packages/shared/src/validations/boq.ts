// ============================================================================
// BOQ (Bill of Quantities) validation schemas
// ============================================================================

import { z } from "zod";
import { BOQ_STATUSES } from "../constants";

export const createBoqSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  version: z.number().int().positive().optional().default(1),
  status: z.enum(BOQ_STATUSES).optional().default("draft"),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateBoqSchema = z.object({
  status: z.enum(BOQ_STATUSES).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const createBoqItemSchema = z.object({
  boq_id: z.string().uuid("Invalid BOQ ID"),
  volume_id: z.string().uuid("Invalid volume ID").nullable().optional(),
  material_id: z.string().uuid("Invalid material ID").nullable().optional(),
  work_type: z.string().max(255).nullable().optional(),
  work_quantity: z.number().nonnegative("Work quantity must be non-negative").nullable().optional(),
  material_quantity: z.number().nonnegative("Material quantity must be non-negative").nullable().optional(),
  unit: z.string().min(1, "Unit is required").max(50),
  unit_price: z.number().nonnegative("Unit price must be non-negative").nullable().optional(),
  section: z.string().max(255).nullable().optional(),
  sort_order: z.number().int().nonnegative().optional().default(0),
});

export const updateBoqItemSchema = createBoqItemSchema.omit({ boq_id: true }).partial();

export const createVolumeCalculationSchema = z.object({
  boq_item_id: z.string().uuid("Invalid BOQ item ID"),
  calculated_qty: z.number().positive("Calculated quantity must be positive"),
  unit: z.string().min(1, "Unit is required").max(50),
  coefficient: z.number().positive("Coefficient must be positive").optional().default(1.0),
  method: z.string().max(255).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreateBoqInput = z.infer<typeof createBoqSchema>;
export type UpdateBoqInput = z.infer<typeof updateBoqSchema>;
export type CreateBoqItemInput = z.infer<typeof createBoqItemSchema>;
export type UpdateBoqItemInput = z.infer<typeof updateBoqItemSchema>;
export type CreateVolumeCalculationInput = z.infer<typeof createVolumeCalculationSchema>;
