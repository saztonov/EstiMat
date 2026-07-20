-- 0074_supplier_order_approval.sql
-- Согласование поставщика руководителем.
--
-- Флоу: инженер собирает предложения, выбирает победителя и вводит цены → заказ переходит в
-- 'approval' (состав и резерв материалов заморожены) → руководитель подтверждает (→ 'awarded')
-- или отклоняет с комментарием (→ 'sourcing', предложение и цены сохраняются для правки).
--
-- Почему отдельный СТАТУС, а не флаг: sourcing_status — единственная ось стадии заказа, на неё
-- завязаны FROZEN_LOT_STATUSES, hasActiveAllocations, все подзапросы «активных» лотов, реестр и
-- шаги в интерфейсе. Флаг при sourcing_status='sourcing' означал бы, что существующие проверки
-- «идёт закупка» продолжают пускать присуждение, и каждую из них пришлось бы дописывать — любая
-- пропущенная стала бы дырой в обход согласования.
--
-- Почему proposed_offer_id отдельно от awarded_quote_id: при отклонении выбор поставщика должен
-- СОХРАНИТЬСЯ (инженер правит своё предложение, а не набирает заново), а признаки присуждения —
-- остаться пустыми. При подтверждении значение копируется в awarded_quote_id.
--
-- Поля awarded_* заполняются только при подтверждении, поэтому supplier_orders_awarded_fields_check
-- остаётся валидной страховкой: на стадии 'approval' известны поставщик, сумма и цены, но заказ
-- ещё не присуждён.
--
-- Идемпотентно, один батч (deploy-estimat --migrate): ADD COLUMN IF NOT EXISTS, пересоздание
-- CHECK как расширенного супернабора (приём из 0058), индекс IF NOT EXISTS.

ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS approval_requested_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS approved_at           TIMESTAMPTZ;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS approved_by           UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS approval_comment      TEXT;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS proposed_offer_id     UUID REFERENCES supplier_order_offers(id) ON DELETE SET NULL;

-- Стадия 'approval' в перечне (пересоздаём CHECK как расширенный супернабор — приём 0058:23-27).
ALTER TABLE supplier_orders DROP CONSTRAINT IF EXISTS supplier_orders_sourcing_status_check;
ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_sourcing_status_check
  CHECK (sourcing_status IS NULL OR sourcing_status IN
         ('forming','sourcing','approval','awarded','cancel_pending','cancelled','no_award'));

-- Предложение, ушедшее на согласование, обязано нести поставщика и сумму: руководитель
-- подтверждает конкретные условия, а не пустую форму.
ALTER TABLE supplier_orders DROP CONSTRAINT IF EXISTS supplier_orders_approval_fields_check;
ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_approval_fields_check
  CHECK (sourcing_status IS DISTINCT FROM 'approval'
         OR (supplier_name IS NOT NULL AND amount IS NOT NULL));

-- Очередь согласования: выборка «ждут подтверждения» бьёт по одному значению статуса.
CREATE INDEX IF NOT EXISTS idx_supplier_orders_approval
  ON supplier_orders(sourcing_status) WHERE sourcing_status = 'approval';
