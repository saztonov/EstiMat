-- 0043: убрать исторический вид заявки 'legacy' («Архив»).
--   * Заявки с видом legacy удаляются (каскад уберёт позиции, файлы, ревизии, заказы;
--     в payment_requests ссылка обнулится по ON DELETE SET NULL).
--   * CHECK на request_type пересобирается без 'legacy' — остаются рабочие виды
--     (own_supplier | su10 | own_supply).
-- Идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

-- ============================================================
-- 1. Удалить архивные (legacy) заявки
-- ============================================================
DELETE FROM material_requests WHERE request_type = 'legacy';

-- ============================================================
-- 2. Пересобрать именованный CHECK без 'legacy'
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_request_type_check') THEN
    ALTER TABLE material_requests DROP CONSTRAINT material_requests_request_type_check;
  END IF;
  ALTER TABLE material_requests
    ADD CONSTRAINT material_requests_request_type_check
    CHECK (request_type IN ('own_supplier', 'su10', 'own_supply'));
END $$;
