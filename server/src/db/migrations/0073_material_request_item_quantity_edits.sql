-- 0073_material_request_item_quantity_edits.sql
-- Отметка правки объёма позиции заявки: кто, когда и каким объём был изначально.
--
-- Это денормализованный ИНДИКАТОР СОСТОЯНИЯ для интерфейса (подсветка строки «изменение объёма»
-- и подсказка «было столько»), переживающий перезагрузку. Полная история правок остаётся в
-- audit_log (action='items_quantity_updated'), поэтому отдельной таблицы правок не заводим:
-- она дублировала бы журнал. Прямой прецедент такой денормализации — is_rejected/rejected_by/
-- rejected_at у документов заявки (0055).
--
-- quantity_original не перезаписывается повторными правками (COALESCE в UPDATE), поэтому
-- подсказка всегда показывает объём, с которого начали, а не предыдущий шаг.
--
-- Доработка заявки пересоздаёт позиции (revision-complete), из-за чего отметки сбрасываются —
-- это ожидаемо: после доработки состав согласован заново.
--
-- Индекс не нужен: позиции всегда выбираются по request_id, где индекс уже есть (0028).
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч,
-- чистый SQL).

ALTER TABLE material_request_items ADD COLUMN IF NOT EXISTS quantity_original   NUMERIC;
ALTER TABLE material_request_items ADD COLUMN IF NOT EXISTS quantity_changed_at TIMESTAMPTZ;
ALTER TABLE material_request_items ADD COLUMN IF NOT EXISTS quantity_changed_by UUID REFERENCES users(id) ON DELETE SET NULL;
