// ============================================================================
// Common types used across all modules
// ============================================================================

/** UUID string type alias for semantic clarity */
export type UUID = string;

/** ISO 8601 timestamp string */
export type Timestamp = string;

/** Base entity with common audit fields */
export interface BaseEntity {
  id: UUID;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Paginated query result wrapper */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/** Standard API response envelope */
export interface ApiResponse<T> {
  data?: T;
  error?: {
    message: string;
    details?: unknown;
  };
}

/** Generic select/dropdown option */
export interface SelectOption {
  value: string;
  label: string;
}

/** Sort direction for queries */
export type SortDirection = "asc" | "desc";

/** Generic query filter parameters */
export interface QueryParams {
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_direction?: SortDirection;
  search?: string;
}
