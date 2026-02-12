// ============================================================================
// Notification types
// ============================================================================

import type { UUID, Timestamp } from "./common";

export interface Notification {
  id: UUID;
  user_id: UUID;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: UUID | null;
  is_read: boolean;
  created_at: Timestamp;
}

export interface NotificationListParams {
  user_id?: UUID;
  is_read?: boolean;
  entity_type?: string;
  page?: number;
  limit?: number;
}
