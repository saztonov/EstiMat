// ============================================================================
// Delivery, Acceptance Doc, Transfer, Sale, and Writeoff validation schemas
// ============================================================================

import { z } from "zod";
import {
  DELIVERY_STATUSES,
  RECEIVER_TYPES,
  ACCEPTANCE_DOC_TYPES,
  TRANSFER_TYPES,
  TRANSFER_STATUSES,
  SALE_STATUSES,
  WRITEOFF_STATUSES,
} from "../constants";

export const createDeliverySchema = z.object({
  order_id: z.string().uuid("Invalid order ID"),
  project_id: z.string().uuid("Invalid project ID"),
  status: z.enum(DELIVERY_STATUSES).optional().default("shipped"),
  tracking: z.string().max(255).nullable().optional(),
  expected_date: z.string().date("Invalid expected date").nullable().optional(),
  actual_date: z.string().date("Invalid actual date").nullable().optional(),
  receiver_type: z.enum(RECEIVER_TYPES).nullable().optional(),
  receiver_id: z.string().uuid("Invalid receiver ID").nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateDeliverySchema = createDeliverySchema
  .omit({ order_id: true, project_id: true })
  .partial();

export const createDeliveryItemSchema = z.object({
  delivery_id: z.string().uuid("Invalid delivery ID"),
  po_item_id: z.string().uuid("Invalid PO item ID"),
  shipped_qty: z.number().positive("Shipped quantity must be positive"),
  accepted_qty: z.number().nonnegative("Accepted quantity must be non-negative").optional().default(0),
  rejected_qty: z.number().nonnegative("Rejected quantity must be non-negative").optional().default(0),
  rejection_reason: z.string().max(1000).nullable().optional(),
});

/** Schema for the acceptance workflow: array of items with acceptance quantities */
export const acceptDeliverySchema = z.object({
  items: z.array(
    z.object({
      delivery_item_id: z.string().uuid("Invalid delivery item ID"),
      accepted_qty: z.number().nonnegative("Accepted quantity must be non-negative"),
      rejected_qty: z.number().nonnegative("Rejected quantity must be non-negative"),
      rejection_reason: z.string().max(1000).nullable().optional(),
    })
  ).min(1, "At least one item is required"),
});

export const createAcceptanceDocSchema = z.object({
  delivery_id: z.string().uuid("Invalid delivery ID"),
  type: z.enum(ACCEPTANCE_DOC_TYPES),
  file_path: z.string().min(1, "File path is required").max(500),
  notes: z.string().max(1000).nullable().optional(),
});

export const createTransferSchema = z.object({
  delivery_id: z.string().uuid("Invalid delivery ID"),
  contractor_id: z.string().uuid("Invalid contractor ID"),
  type: z.enum(TRANSFER_TYPES).optional().default("davalcheskie"),
  doc_number: z.string().min(1, "Document number is required").max(100),
  doc_date: z.string().date("Invalid document date"),
  items: z.array(z.record(z.string(), z.unknown())).min(1, "At least one item is required"),
  status: z.enum(TRANSFER_STATUSES).optional().default("draft"),
});

export const updateTransferSchema = createTransferSchema
  .omit({ delivery_id: true, contractor_id: true })
  .partial();

export const createSaleSchema = z.object({
  delivery_id: z.string().uuid("Invalid delivery ID"),
  contractor_id: z.string().uuid("Invalid contractor ID"),
  invoice_number: z.string().max(100).nullable().optional(),
  amount: z.number().positive("Amount must be positive"),
  status: z.enum(SALE_STATUSES).optional().default("draft"),
  items: z.array(z.record(z.string(), z.unknown())).min(1, "At least one item is required"),
});

export const updateSaleSchema = createSaleSchema
  .omit({ delivery_id: true, contractor_id: true })
  .partial();

export const createWriteoffSchema = z.object({
  delivery_id: z.string().uuid("Invalid delivery ID"),
  project_id: z.string().uuid("Invalid project ID"),
  site_id: z.string().uuid("Invalid site ID").nullable().optional(),
  writeoff_date: z.string().date("Invalid writeoff date"),
  items: z.array(z.record(z.string(), z.unknown())).min(1, "At least one item is required"),
  status: z.enum(WRITEOFF_STATUSES).optional().default("draft"),
});

export const updateWriteoffSchema = createWriteoffSchema
  .omit({ delivery_id: true, project_id: true })
  .partial();

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryInput = z.infer<typeof updateDeliverySchema>;
export type CreateDeliveryItemInput = z.infer<typeof createDeliveryItemSchema>;
export type AcceptDeliveryInput = z.infer<typeof acceptDeliverySchema>;
export type CreateAcceptanceDocInput = z.infer<typeof createAcceptanceDocSchema>;
export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type UpdateTransferInput = z.infer<typeof updateTransferSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type UpdateSaleInput = z.infer<typeof updateSaleSchema>;
export type CreateWriteoffInput = z.infer<typeof createWriteoffSchema>;
export type UpdateWriteoffInput = z.infer<typeof updateWriteoffSchema>;
