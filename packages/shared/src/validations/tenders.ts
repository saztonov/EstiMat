// ============================================================================
// Tender, Tender Lot, and Long-Term Order validation schemas
// ============================================================================

import { z } from "zod";
import { TENDER_TYPES, TENDER_STATUSES, LT_ORDER_STATUSES } from "../constants";

export const createTenderSchema = z.object({
  project_id: z.string().uuid("Invalid project ID").nullable().optional(),
  material_group_id: z.string().uuid("Invalid material group ID").nullable().optional(),
  type: z.enum(TENDER_TYPES),
  status: z.enum(TENDER_STATUSES).optional().default("draft"),
  period_start: z.string().date("Invalid period start date").nullable().optional(),
  period_end: z.string().date("Invalid period end date").nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateTenderSchema = createTenderSchema.partial();

export const createTenderLotSchema = z.object({
  tender_id: z.string().uuid("Invalid tender ID"),
  material_id: z.string().uuid("Invalid material ID"),
  total_quantity: z.number().positive("Total quantity must be positive"),
  unit: z.string().min(1, "Unit is required").max(50),
  specifications: z.record(z.string(), z.unknown()).optional().default({}),
});

export const createTenderLotRequestSchema = z.object({
  lot_id: z.string().uuid("Invalid lot ID"),
  pr_item_id: z.string().uuid("Invalid PR item ID"),
});

export const createLongTermOrderSchema = z.object({
  contract_id: z.string().uuid("Invalid contract ID"),
  material_id: z.string().uuid("Invalid material ID"),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.string().min(1, "Unit is required").max(50),
  required_date: z.string().date("Invalid required date").nullable().optional(),
  status: z.enum(LT_ORDER_STATUSES).optional().default("draft"),
  pr_item_id: z.string().uuid("Invalid PR item ID").nullable().optional(),
});

export const updateLongTermOrderSchema = createLongTermOrderSchema
  .omit({ contract_id: true, material_id: true })
  .partial();

export type CreateTenderInput = z.infer<typeof createTenderSchema>;
export type UpdateTenderInput = z.infer<typeof updateTenderSchema>;
export type CreateTenderLotInput = z.infer<typeof createTenderLotSchema>;
export type CreateTenderLotRequestInput = z.infer<typeof createTenderLotRequestSchema>;
export type CreateLongTermOrderInput = z.infer<typeof createLongTermOrderSchema>;
export type UpdateLongTermOrderInput = z.infer<typeof updateLongTermOrderSchema>;
