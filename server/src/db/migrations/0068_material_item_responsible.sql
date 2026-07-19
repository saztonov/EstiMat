-- Персональный ответственный за строку материала заявки (override поверх ответственных по
-- категории вида работ из справочника «Закупки», procurement_category_responsibles).
-- NULL — override не задан: в своде «Материалы» отображаются все ответственные по категории
-- (прежнее поведение). Назначение «на вид/группу» = то же поле, проставленное bulk'ом по
-- набору строк свода (request_item_id) — узлы дерева контекстны (объект/подрядчик/вид/заявка),
-- поэтому набор строк, а не глобальное правило per cost_type.
-- ON DELETE SET NULL: users удаляются hard-delete'ом (0029); при удалении назначенного или
-- назначившего строка переживает удаление, override сбрасывается на дефолт.
-- Аддитивная идемпотентная миграция (deploy-estimat --migrate: один батч, чистый SQL).

ALTER TABLE material_request_items
  ADD COLUMN IF NOT EXISTS responsible_user_id     UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE material_request_items
  ADD COLUMN IF NOT EXISTS responsible_assigned_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE material_request_items
  ADD COLUMN IF NOT EXISTS responsible_assigned_at TIMESTAMPTZ;

-- Частичный индекс: выборки «мои материалы» и join ФИО только по назначенным строкам.
CREATE INDEX IF NOT EXISTS ix_mri_responsible
  ON material_request_items (responsible_user_id)
  WHERE responsible_user_id IS NOT NULL;
