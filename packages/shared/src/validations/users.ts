// ============================================================================
// User validation schemas
// ============================================================================

import { z } from "zod";
import { USER_ROLES } from "../constants";

export const createUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  full_name: z.string().min(1, "Full name is required").max(255),
  org_id: z.string().uuid("Invalid organization ID").nullable().optional(),
  role: z.enum(USER_ROLES),
  phone: z.string().max(20).nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

export const updateUserSchema = createUserSchema.partial();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
