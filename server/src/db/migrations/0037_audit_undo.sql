-- 0037_audit_undo.sql
-- Поддержка пользовательской отмены действий в смете поверх журнала audit_log.
-- Отмена восстанавливает состояние строк из снимков before/after, которые журнал
-- уже пишет в той же транзакции, что и мутацию. Добавляем пометку «отменено»
-- (undone_at/undone_by) и различение обычных/undo-записей (origin), чтобы отмена
-- продвигалась по стеку и не отменяла саму себя.
-- Идемпотентно: ADD COLUMN IF NOT EXISTS, pg_constraint-guard, CREATE INDEX IF NOT EXISTS.

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin    TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS undo_of   UUID;   -- correlation_id группы, отменённой сводной origin='undo' записью

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_origin_check') THEN
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_origin_check CHECK (origin IN ('user', 'undo', 'redo'));
  END IF;
END $$;

-- Точный поиск «последняя активная своя undoable-группа в смете» (undo-target и peek).
-- Частичный индекс покрывает ровно отменяемые записи пользователя (не тиражирование/ai_apply,
-- которые тоже несут correlation_id, но не помечены undoable).
CREATE INDEX IF NOT EXISTS idx_audit_log_undo_stack
  ON audit_log (estimate_id, user_id, created_at DESC)
  WHERE origin = 'user' AND (changes->>'undoable') = 'true';
