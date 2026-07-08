-- 0034: связка шифров РД с видом работ в контексте сметы (many-to-many).
--   * «Вид работ» в смете определяется парой (estimate_id, cost_type_id) — отдельной
--     строки-группы в БД нет, группы собираются на клиенте из estimate_items.
--   * Виду работ можно сопоставить несколько шифров (мультивыбор) — отсюда составной PK.
--   * ON DELETE CASCADE по всем трём ссылкам: удалили смету / вид работ из справочника /
--     шифр объекта — связки автоматически очищаются.
--   * Индекс по cipher_id ускоряет каскад при удалении шифра объекта.
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

CREATE TABLE IF NOT EXISTS estimate_cost_type_ciphers (
  estimate_id  UUID NOT NULL REFERENCES estimates(id)          ON DELETE CASCADE,
  cost_type_id UUID NOT NULL REFERENCES cost_types(id)         ON DELETE CASCADE,
  cipher_id    UUID NOT NULL REFERENCES project_rd_ciphers(id) ON DELETE CASCADE,
  PRIMARY KEY (estimate_id, cost_type_id, cipher_id)
);

CREATE INDEX IF NOT EXISTS idx_ectc_estimate_costtype
  ON estimate_cost_type_ciphers (estimate_id, cost_type_id);
CREATE INDEX IF NOT EXISTS idx_ectc_cipher
  ON estimate_cost_type_ciphers (cipher_id);
