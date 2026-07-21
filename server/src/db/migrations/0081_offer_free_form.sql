-- 0081: поставщик-предложение добавляется свободной формой.
--
-- ПОЧЕМУ НАЗВАНИЕ ПЕРЕСТАЛО БЫТЬ ОБЯЗАТЕЛЬНЫМ. Инженер собирает КП и от поставщиков, которых в
-- справочнике организаций ещё нет: раньше строку нельзя было завести, не заведя сначала
-- организацию. Теперь достаточно комментария (note) — например «прислали по почте, реквизиты в КП».
--
-- ЧТО ЗАЩИЩАЕТ ИНВАРИАНТ. Пустая строка предложения бессмысленна, поэтому хотя бы одно из полей —
-- название или комментарий — должно быть заполнено ПО СУЩЕСТВУ: btrim отсекает строки из пробелов,
-- которые иначе прошли бы обычную проверку на NULL.
--
-- ПРИВЯЗКА К СПРАВОЧНИКУ ПЕРЕЕХАЛА НА ПОБЕДИТЕЛЯ. Свободная форма допустима, пока предложение —
-- одно из многих. На согласование руководителю уходит конкретный контрагент, поэтому у заказа в
-- стадии 'approval' supplier_id теперь обязателен. Стадию 'awarded' НЕ трогаем: у тендерных побед
-- поставщик приходит с площадки и в справочнике его может не быть.
--
-- Идемпотентно, один батч (deploy-estimat --migrate).

ALTER TABLE supplier_order_offers ALTER COLUMN supplier_name DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_order_offers_name_or_note_check') THEN
    ALTER TABLE supplier_order_offers ADD CONSTRAINT supplier_order_offers_name_or_note_check
      CHECK (NULLIF(btrim(supplier_name), '') IS NOT NULL OR NULLIF(btrim(note), '') IS NOT NULL);
  END IF;
END $$;

-- Перечень обязательных полей согласования пересоздаём как расширенный супернабор (приём 0074).
ALTER TABLE supplier_orders DROP CONSTRAINT IF EXISTS supplier_orders_approval_fields_check;
ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_approval_fields_check
  CHECK (sourcing_status IS DISTINCT FROM 'approval'
         OR (supplier_id IS NOT NULL AND supplier_name IS NOT NULL AND amount IS NOT NULL));
