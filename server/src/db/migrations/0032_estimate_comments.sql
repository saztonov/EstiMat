-- 0032: комментарии (примечания) к работам и видам работ в контексте сметы.
--   * Раздельные FK item_id / cost_type_id (полиморфную ссылку не используем) —
--     настоящая ссылочная целостность и авто-очистка по ON DELETE CASCADE
--     (удалили работу → её комментарии удалились; удалили смету → все комментарии).
--   * CHECK гарантирует ровно одну цель: work → item_id, cost_type → cost_type_id.
--   * cost_type-комментарий привязан к КОНКРЕТНОЙ смете (estimate_id + cost_type_id),
--     а не к глобальному справочнику видов работ.
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

CREATE TABLE IF NOT EXISTS estimate_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id  UUID NOT NULL REFERENCES estimates(id)      ON DELETE CASCADE,
  item_id      UUID          REFERENCES estimate_items(id) ON DELETE CASCADE,
  cost_type_id UUID          REFERENCES cost_types(id)     ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Ровно одна цель комментария.
  CONSTRAINT estimate_comments_one_target CHECK (
    (item_id IS NOT NULL AND cost_type_id IS NULL) OR
    (item_id IS NULL AND cost_type_id IS NOT NULL)
  )
);

-- Частичные индексы под выборку ленты по цели (newest-first) и подсчёт счётчиков.
CREATE INDEX IF NOT EXISTS idx_estimate_comments_item
  ON estimate_comments (estimate_id, item_id, created_at) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estimate_comments_cost_type
  ON estimate_comments (estimate_id, cost_type_id, created_at) WHERE cost_type_id IS NOT NULL;

-- Авто-обновление updated_at при редактировании (общая функция из 0001).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimate_comments_updated_at') THEN
    CREATE TRIGGER trg_estimate_comments_updated_at
      BEFORE UPDATE ON estimate_comments
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
