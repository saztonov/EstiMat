-- 0082: договорные цены работ и материалов (раздел «Подрядчики»).
--
--   * Договорная цена приходит из заполненного подрядчиком ВОР и хранится ОТДЕЛЬНО от базовой
--     (unit_price/total из справочника расценок): базовая остаётся источником сметной стоимости,
--     договорная показывается в разделе «Подрядчики». Итог сметы (recalc_estimate_total) не трогаем.
--   * contract_price_contractor_id — чья это цена. При смене исполнителя строки цена прежнего
--     подрядчика снимается (см. clearStaleContractPrices), поэтому чужая цена не «прилипает».
--   * contract_total — генерируемая колонка (как total): NULL, пока нет договорной цены. Добавляется
--     ОТДЕЛЬНЫМ ALTER — выражение ссылается на колонку, созданную предыдущим оператором.
--   * estimate_vors.content_facets — местоположения и типы строк на момент выгрузки (из построчного
--     снимка). Нужны реестру ВОР в разделе «Подрядчики»: текущее состояние сметы для этого не
--     годится — работу могли изменить или удалить после выгрузки.
--   * estimate_vor_price_uploads — журнал загрузок заполненных ВОР: что именно прислал подрядчик,
--     когда и сколько позиций обновило. Пишется best-effort после применения цен.
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS contract_unit_price          NUMERIC,
  ADD COLUMN IF NOT EXISTS contract_price_vor_id        UUID REFERENCES estimate_vors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_price_contractor_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_price_updated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_price_updated_by    UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS contract_total NUMERIC
    GENERATED ALWAYS AS (quantity * contract_unit_price) STORED;

ALTER TABLE estimate_materials
  ADD COLUMN IF NOT EXISTS contract_unit_price          NUMERIC,
  ADD COLUMN IF NOT EXISTS contract_price_vor_id        UUID REFERENCES estimate_vors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_price_contractor_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_price_updated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contract_price_updated_by    UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE estimate_materials
  ADD COLUMN IF NOT EXISTS contract_total NUMERIC
    GENERATED ALWAYS AS (quantity * contract_unit_price) STORED;

-- Отрицательная договорная цена — всегда ошибка ввода; ноль допустим (работа «в подарок»).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimate_items_contract_price_nonneg') THEN
    ALTER TABLE estimate_items
      ADD CONSTRAINT estimate_items_contract_price_nonneg
      CHECK (contract_unit_price IS NULL OR contract_unit_price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimate_materials_contract_price_nonneg') THEN
    ALTER TABLE estimate_materials
      ADD CONSTRAINT estimate_materials_contract_price_nonneg
      CHECK (contract_unit_price IS NULL OR contract_unit_price >= 0);
  END IF;
END $$;

-- Строки с договорной ценой — для выборок «что уже оценено подрядчиком».
CREATE INDEX IF NOT EXISTS idx_estimate_items_contract_price
  ON estimate_items (estimate_id) WHERE contract_unit_price IS NOT NULL;

-- Исторические фасеты ВОР: { "locations": [...], "types": [...] }. NULL — ещё не посчитаны
-- (ВОР, созданные до этой миграции; досчитываются лениво из снимка при открытии реестра).
ALTER TABLE estimate_vors
  ADD COLUMN IF NOT EXISTS content_facets JSONB;

CREATE TABLE IF NOT EXISTS estimate_vor_price_uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vor_id          UUID NOT NULL REFERENCES estimate_vors(id) ON DELETE CASCADE,
  estimate_id     UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  contractor_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Файл best-effort: цены уже применены, даже если хранилище недоступно (тогда file_key = NULL).
  file_key        TEXT,
  file_name       TEXT NOT NULL,
  file_size       BIGINT,
  checksum        TEXT,
  works_updated     INT NOT NULL DEFAULT 0,
  materials_updated INT NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vor_price_uploads_vor
  ON estimate_vor_price_uploads (vor_id, created_at DESC);
