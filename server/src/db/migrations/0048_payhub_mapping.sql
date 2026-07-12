-- 0048: сопоставление объекта EstiMat с проектом и получателем PayHub (для создания РП-письма).
--   payhub_project_id     — проект PayHub, куда падает письмо;
--   payhub_contractor_id  — контрагент-получатель РП (застройщик объекта).
--   Отправитель РП — глобально в app_settings (ключ 'payhub_rp_sender', заполняется из админки).
--   BIGINT: id проектов/контрагентов PayHub — serial/bigserial.
-- Аддитивная и идемпотентная миграция.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS payhub_project_id    BIGINT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS payhub_contractor_id BIGINT;
