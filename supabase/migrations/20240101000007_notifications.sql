-- =============================================================================
-- Migration 7: Notifications
-- EstiMat - Construction Materials Procurement System
-- =============================================================================
-- Creates: notifications
-- In-app notification system for status changes, approvals, deadlines, etc.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Notifications (uvedomleniya)
-- In-app notifications delivered to specific users.
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT,
  type TEXT NOT NULL DEFAULT 'info'
    CHECK (type IN ('info', 'warning', 'error', 'success', 'approval_request', 'status_change', 'deadline')),
  entity_type TEXT,
  entity_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Composite index for efficient queries:
-- "Show me all unread notifications for user X, newest first"
-- ---------------------------------------------------------------------------
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_entity ON notifications(entity_type, entity_id);
