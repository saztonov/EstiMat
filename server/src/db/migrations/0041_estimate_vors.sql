-- 0041: история выгрузок ВОР (ведомость объёмов работ) по смете.
--   * Каждый экспорт сметы в Excel сохраняется как запись ВОР со снимком .xlsx в S3.
--   * request_id + UNIQUE(estimate_id, request_id) — идемпотентность: повтор того же запроса
--     (сетевой таймаут, переигровка после конфликта единиц) не создаёт вторую запись.
--   * Файловые поля NOT NULL: запись ВОР появляется только после успешной загрузки файла в S3
--     (единая транзакция вставки, см. роут POST /:id/vors).
--   * created_by_name — снимок автора на момент создания (переживает удаление пользователя).
--   * project_id и список шифров НЕ храним: проект выводится через смету, а шифры уже зафиксированы
--     внутри неизменяемого XLSX (ячейка C7).
--   * estimate_vor_items — какие строки сметы вошли в ВОР (для отметки «В» на строках). CASCADE по
--     item_id: удалили строку — связь (и метка) исчезают автоматически; сам файл-снимок остаётся.
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

CREATE TABLE IF NOT EXISTS estimate_vors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id     UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  request_id      UUID NOT NULL,
  name            TEXT NOT NULL,
  filters         JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_key        TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_size       BIGINT NOT NULL,
  mime_type       TEXT NOT NULL,
  checksum        TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (estimate_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_estimate_vors_estimate
  ON estimate_vors (estimate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS estimate_vor_items (
  vor_id  UUID NOT NULL REFERENCES estimate_vors(id)  ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES estimate_items(id) ON DELETE CASCADE,
  PRIMARY KEY (vor_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_estimate_vor_items_item
  ON estimate_vor_items (item_id);
