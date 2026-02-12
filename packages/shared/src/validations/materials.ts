// ============================================================================
// Material Group and Material Catalog validation schemas
// ============================================================================

import { z } from "zod";

export const createMaterialGroupSchema = z.object({
  name: z.string().min(1, "Group name is required").max(255),
  parent_id: z.string().uuid("Invalid parent group ID").nullable().optional(),
  code: z.string().max(50).nullable().optional(),
});

export const createMaterialSchema = z.object({
  name: z.string().min(1, "Material name is required").max(255),
  group_id: z.string().uuid("Invalid group ID").nullable().optional(),
  unit: z.string().min(1, "Unit is required").max(50),
  description: z.string().max(1000).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
  is_active: z.boolean().optional().default(true),
});

export const updateMaterialSchema = createMaterialSchema.partial();

export type CreateMaterialGroupInput = z.infer<typeof createMaterialGroupSchema>;
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
