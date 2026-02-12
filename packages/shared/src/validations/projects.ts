// ============================================================================
// Project, ProjectMember, and Site validation schemas
// ============================================================================

import { z } from "zod";
import { PROJECT_STATUSES } from "../constants";

export const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(255),
  org_id: z.string().uuid("Invalid organization ID"),
  address: z.string().max(500).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional().default("planning"),
  start_date: z.string().date("Invalid start date").nullable().optional(),
  end_date: z.string().date("Invalid end date").nullable().optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const addProjectMemberSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  user_id: z.string().uuid("Invalid user ID"),
  role: z.string().min(1, "Role is required").max(100),
});

export const createSiteSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  name: z.string().min(1, "Site name is required").max(255),
  address: z.string().max(500).nullable().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type CreateSiteInput = z.infer<typeof createSiteSchema>;
