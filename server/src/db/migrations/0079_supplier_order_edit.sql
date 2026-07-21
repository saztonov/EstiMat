-- 0079: правка и отмена уже присуждённого заказа поставщику.
--
-- ЗАЧЕМ. До сих пор состав заказа замораживался навсегда с момента фиксации: единственным способом
-- убрать лишнюю позицию или поправить объём была отмена всего заказа и сбор его заново. Отменить
-- присуждённый заказ было нельзя вовсе. На практике поставка меняется уже после присуждения, и
-- снабжение должно уметь это отразить, а не обходить систему.
--
-- ЧТО РАЗРЕШЕНО. Правка объёмов и удаление позиций — в forming, sourcing и awarded. Стадия
-- 'approval' НЕ входит сознательно (обоснование из 0074): руководитель видит конкретный состав и
-- сумму, и менять их под ним нельзя. Терминальные стадии тоже закрыты — там менять нечего.
--
-- ПОЧЕМУ РЕЗЕРВ НЕ ТРОГАЕМ. Он вычисляемый: «размещено» = SUM(supplier_order_items.quantity) по
-- заказам вне cancelled/no_award. Поэтому уменьшение объёма или удаление позиции само возвращает
-- остаток в свод, а отмена присуждённого заказа = смена стадии. Компенсирующих записей не нужно.
--
-- ПОЧЕМУ ПРИЗНАКИ ПРИСУЖДЕНИЯ ПРИ ОТМЕНЕ СОХРАНЯЮТСЯ. Отменённый заказ остаётся историческим
-- документом: реестр и аудит должны показывать, кто и на какую сумму был присуждён. Ограничение
-- supplier_orders_awarded_fields_check действует только при sourcing_status='awarded', поэтому
-- хранение этих полей в отменённом заказе легально.
--
-- Идемпотентно, один батч (deploy-estimat --migrate).

-- Реквизиты отмены. Причина обязательна только для отмены ПРИСУЖДЁННОГО заказа — проверка в роуте:
-- у исторических отмен причины нет, и CHECK сделал бы миграцию невозможной.
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS cancelled_by  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- История правок состава заказа. Модель повторяет material_request_quantity_edits (0076): строка
-- истории принадлежит ОДНОЙ пользовательской операции, а операция — записи журнала.
CREATE TABLE IF NOT EXISTS supplier_order_item_edits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Операция. CASCADE уместен: без своей записи журнала подробности ничего не значат.
  audit_id      UUID NOT NULL REFERENCES audit_log(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  -- Позиция — БЕЗ каскада: история удалённой строки обязана пережить саму строку.
  order_item_id UUID REFERENCES supplier_order_items(id) ON DELETE SET NULL,
  -- Снимки: позиция может исчезнуть, а история обязана остаться читаемой.
  material_name TEXT NOT NULL,
  agg_key       TEXT NOT NULL,
  quantity_from NUMERIC NOT NULL,
  -- Для удаления позиции — 0: строка ушла из заказа целиком.
  quantity_to   NUMERIC NOT NULL,
  action        TEXT NOT NULL,
  changed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'soie_action_check') THEN
    ALTER TABLE supplier_order_item_edits ADD CONSTRAINT soie_action_check
      CHECK (action IN ('quantity_changed','removed'));
  END IF;
  -- Запись «ничего не изменилось» замусорила бы историю. Сравнение numeric, а не текстовое:
  -- '10.0' и '10' здесь равны, как и должны быть.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'soie_actually_changed') THEN
    ALTER TABLE supplier_order_item_edits ADD CONSTRAINT soie_actually_changed
      CHECK (quantity_from <> quantity_to);
  END IF;
END $$;

-- Одна позиция — одна строка в рамках операции: повтор запроса не задваивает запись.
CREATE UNIQUE INDEX IF NOT EXISTS ux_soie_operation_item
  ON supplier_order_item_edits(audit_id, order_item_id);
CREATE INDEX IF NOT EXISTS ix_soie_order ON supplier_order_item_edits(order_id, changed_at DESC);
