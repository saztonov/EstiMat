// ============================================================================
// Contract validation schemas
// ============================================================================

import { z } from "zod";
import { CONTRACT_STATUSES } from "../constants";

export const createContractSchema = z.object({
  supplier_id: z.string().uuid("Invalid supplier ID"),
  project_id: z.string().uuid("Invalid project ID").nullable().optional(),
  number: z.string().min(1, "Contract number is required").max(100),
  date: z.string().date("Invalid contract date"),
  valid_until: z.string().date("Invalid valid until date").nullable().optional(),
  terms: z.record(z.string(), z.unknown()).optional().default({}),
  status: z.enum(CONTRACT_STATUSES).optional().default("draft"),
  total_amount: z.number().nonnegative("Total amount must be non-negative").nullable().optional(),
});

export const updateContractSchema = createContractSchema
  .omit({ supplier_id: true })
  .partial();

export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
