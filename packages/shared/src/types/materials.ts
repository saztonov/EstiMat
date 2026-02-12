// ============================================================================
// Material Group and Material Catalog types
// ============================================================================

import type { BaseEntity, UUID, Timestamp } from "./common";

export interface MaterialGroup {
  id: UUID;
  name: string;
  parent_id: UUID | null;
  code: string | null;
  created_at: Timestamp;
}

export interface MaterialGroupWithChildren extends MaterialGroup {
  children?: MaterialGroup[];
}

export interface MaterialCatalog extends BaseEntity {
  name: string;
  group_id: UUID | null;
  unit: string;
  description: string | null;
  attributes: Record<string, unknown>;
  is_active: boolean;
}

export interface MaterialCatalogWithGroup extends MaterialCatalog {
  group?: {
    id: UUID;
    name: string;
    code: string | null;
  } | null;
}

export interface MaterialListParams {
  group_id?: UUID;
  is_active?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}
