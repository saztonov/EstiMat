// ============================================================================
// Purchase Order and PO Item validation schemas
// ============================================================================

import { z } from "zod";
import { PO_STATUSES } from "../constants";

export const createPurchaseOrderSchema = z.object({
  contract_id: z.string().uuid("Invalid contract ID").nullable().optional(),
  tender_id: z.string().uuid("Invalid tender ID").nullable().optional(),
  long_term_order_id: z.string().uuid("Invalid long-term order ID").nullable().optional(),
  supplier_id: z.string().uuid("Invalid supplier ID"),
  project_id: z.string().uuid("Invalid project ID"),
  status: z.enum(PO_STATUSES).optional().default("draft"),
  payment_terms: z.string().max(500).nullable().optional(),
  delivery_date: z.string().date("Invalid delivery date").nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updatePurchaseOrderSchema = createPurchaseOrderSchema
  .omit({ supplier_id: true, project_id: true })
  .partial();

export const createPoItemSchema = z.object({
  order_id: z.string().uuid("Invalid order ID"),
  material_id: z.string().uuid("Invalid material ID"),
  lot_id: z.string().uuid("Invalid lot ID").nullable().optional(),
  quantity: z.number().positive("Quantity must be positive"),
  unit_price: z.number().nonnegative("Unit price must be non-negative"),
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type CreatePoItemInput = z.infer<typeof createPoItemSchema>;
