// ============================================================================
// Purchase Request, PR Item, Distribution Letter, and Advance validation schemas
// ============================================================================

import { z } from "zod";
import {
  FUNDING_TYPES,
  PR_STATUSES,
  PR_ITEM_STATUSES,
  DIST_LETTER_STATUSES,
  ADVANCE_STATUSES,
} from "../constants";

export const createPurchaseRequestSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  estimate_id: z.string().uuid("Invalid estimate ID"),
  contractor_id: z.string().uuid("Invalid contractor ID"),
  funding_type: z.enum(FUNDING_TYPES),
  status: z.enum(PR_STATUSES).optional().default("draft"),
  deadline: z.string().date("Invalid deadline date").nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updatePurchaseRequestSchema = createPurchaseRequestSchema
  .omit({ project_id: true, estimate_id: true, contractor_id: true, funding_type: true })
  .partial();

export const createPrItemSchema = z.object({
  request_id: z.string().uuid("Invalid request ID"),
  estimate_item_id: z.string().uuid("Invalid estimate item ID").nullable().optional(),
  material_id: z.string().uuid("Invalid material ID"),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.string().min(1, "Unit is required").max(50),
  required_date: z.string().date("Invalid required date").nullable().optional(),
  status: z.enum(PR_ITEM_STATUSES).optional().default("pending"),
});

export const updatePrItemSchema = createPrItemSchema
  .omit({ request_id: true })
  .partial();

export const createDistributionLetterSchema = z.object({
  request_id: z.string().uuid("Invalid request ID"),
  obs_account: z.string().min(1, "OBS account is required").max(100),
  amount: z.number().positive("Amount must be positive"),
  payment_date: z.string().date("Invalid payment date").nullable().optional(),
  status: z.enum(DIST_LETTER_STATUSES).optional().default("draft"),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateDistributionLetterSchema = createDistributionLetterSchema
  .omit({ request_id: true })
  .partial();

export const createAdvanceSchema = z.object({
  request_id: z.string().uuid("Invalid request ID"),
  contractor_id: z.string().uuid("Invalid contractor ID"),
  amount: z.number().positive("Amount must be positive"),
  purpose: z.string().max(1000).nullable().optional(),
  status: z.enum(ADVANCE_STATUSES).optional().default("draft"),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateAdvanceSchema = createAdvanceSchema
  .omit({ request_id: true, contractor_id: true })
  .partial();

export type CreatePurchaseRequestInput = z.infer<typeof createPurchaseRequestSchema>;
export type UpdatePurchaseRequestInput = z.infer<typeof updatePurchaseRequestSchema>;
export type CreatePrItemInput = z.infer<typeof createPrItemSchema>;
export type UpdatePrItemInput = z.infer<typeof updatePrItemSchema>;
export type CreateDistributionLetterInput = z.infer<typeof createDistributionLetterSchema>;
export type UpdateDistributionLetterInput = z.infer<typeof updateDistributionLetterSchema>;
export type CreateAdvanceInput = z.infer<typeof createAdvanceSchema>;
export type UpdateAdvanceInput = z.infer<typeof updateAdvanceSchema>;
