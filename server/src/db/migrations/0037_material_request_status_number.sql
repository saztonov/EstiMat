-- 0037: номер и статусы заявок на материалы.
--   * request_no — порядковый номер заявки В РАМКАХ ОБЪЕКТА (project_id); отображается как {код объекта}-NN.
--   * status — жизненный цикл заявки: sent (Отправлено) → rp_created (Создан РП) → paid (Оплачено).
--     Старый дефолт 'confirmed' переводится в 'sent'; смену статуса далее проставляют внешние сервисы.
-- Аддитивная и идемпотентная миграция (совместима с deploy-estimat --migrate: один батч, чистый SQL).

-- ============================================================
-- 1. Номер заявки в рамках объекта
-- ============================================================
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS request_no INT;

-- Бэкфилл номеров для существующих заявок: по каждому объекту в порядке создания.
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
    FROM material_requests
   WHERE request_no IS NULL
)
UPDATE material_requests m
   SET request_no = n.rn
  FROM numbered n
 WHERE m.id = n.id;

-- Уникальность номера в рамках объекта (только для заполненных значений).
CREATE UNIQUE INDEX IF NOT EXISTS ux_mr_project_no
  ON material_requests(project_id, request_no)
  WHERE request_no IS NOT NULL;

-- ============================================================
-- 2. Статусы заявки: sent / rp_created / paid
-- ============================================================
UPDATE material_requests SET status = 'sent' WHERE status = 'confirmed';

ALTER TABLE material_requests ALTER COLUMN status SET DEFAULT 'sent';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_status_check') THEN
    ALTER TABLE material_requests
      ADD CONSTRAINT material_requests_status_check
      CHECK (status IN ('sent', 'rp_created', 'paid'));
  END IF;
END $$;
