-- 0014: авторство строк сметы + полноценный журнал изменений (audit trail).
--   * created_by/updated_by на estimate_items / estimate_materials / estimate_contractors —
--     быстрый current-state «кто добавил/менял последним» без обращения в историю.
--   * audit_log: estimate_id (ON DELETE SET NULL — несгораемый журнал переживает удаление
--     сметы), project_id (денормализация), correlation_id (связь summary ↔ row-level ↔ realtime).
--   * индексы для ленты истории сметы и истории конкретной строки.
-- Аддитивная и идемпотентная миграция.

-- ============================================================
-- 1. Авторство на строках
-- ============================================================
ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE estimate_materials
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE estimate_contractors
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================
-- 2. Журнал изменений: контекст сметы/объекта + корреляция
-- ============================================================
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS estimate_id UUID REFERENCES estimates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

-- Лента истории сметы (новые сверху) и история конкретной строки (переживает её удаление —
-- snapshot хранится в changes.before).
CREATE INDEX IF NOT EXISTS idx_audit_log_estimate    ON audit_log(estimate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_time ON audit_log(entity_type, entity_id, created_at);
