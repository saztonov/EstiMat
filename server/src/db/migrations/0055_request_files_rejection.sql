-- 0055: вычёркивание документов заявки («неактуальный» файл, как отклонение файла в billhub).
--   Вычеркнутый документ остаётся видимым и в счётчике, но перестаёт быть действующим:
--   не проходит обязательные проверки (счёт) и не уходит во вложения письма РП в PayHub.
--   Действующий документ = NOT superseded AND NOT is_rejected.
-- Идемпотентная миграция.

ALTER TABLE material_request_files ADD COLUMN IF NOT EXISTS is_rejected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE material_request_files ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE material_request_files ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
