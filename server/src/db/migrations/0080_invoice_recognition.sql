-- 0080: распознавание счёта поставщика моделью и сверка его с заказом.
--
-- ЖИЗНЕННЫЙ ЦИКЛ, А НЕ РАЗОВЫЙ ВЫЗОВ. Обращение к модели идёт 30–120 с: синхронный роут упёрся бы
-- в таймауты прокси и nginx, а пользователь потерял бы результат при перезагрузке страницы.
-- Поэтому у счёта есть статус распознавания, сохранённый результат и возможность повторить.
--
-- ПОЧЕМУ СТРОКА СЧЁТА — САМА СЕБЕ ЗАДАНИЕ. Отдельная таблица заданий (как у группировки) оправдана,
-- когда на прогон приходятся десятки вызовов; здесь вызов ровно один. Но поля блокировки всё равно
-- нужны: без них прогон, прерванный деплоем, навсегда остался бы в статусе 'running'.
--
-- ЧЕТВЁРТЫЙ РОДИТЕЛЬ В ЖУРНАЛЕ ВЫЗОВОВ. ai_llm_calls требует РОВНО ОДНОГО родителя (0065), поэтому
-- писать вызов «без родителя» нельзя конструктивно — добавляем ссылку на счёт и расширяем CHECK.
--
-- Идемпотентно, один батч (deploy-estimat --migrate).

ALTER TABLE supplier_order_invoices
  ADD COLUMN IF NOT EXISTS recognition_status TEXT NOT NULL DEFAULT 'not_run',
  ADD COLUMN IF NOT EXISTS recognition_error  TEXT,
  ADD COLUMN IF NOT EXISTS recognized         JSONB,
  ADD COLUMN IF NOT EXISTS recognized_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recognition_model  TEXT,
  -- Снимок сверки с заказом на момент распознавания.
  ADD COLUMN IF NOT EXISTS match_result       JSONB,
  ADD COLUMN IF NOT EXISTS match_status       TEXT,
  -- Половина канона записи задания (0062): без блокировки прогон не переживает деплой.
  ADD COLUMN IF NOT EXISTS attempts           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_by          TEXT,
  ADD COLUMN IF NOT EXISTS locked_until       TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'soinv_recognition_status_check') THEN
    ALTER TABLE supplier_order_invoices ADD CONSTRAINT soinv_recognition_status_check
      CHECK (recognition_status IN ('not_run','queued','running','succeeded','failed','unsupported'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'soinv_match_status_check') THEN
    ALTER TABLE supplier_order_invoices ADD CONSTRAINT soinv_match_status_check
      CHECK (match_status IS NULL OR match_status IN ('match','warn','unknown'));
  END IF;
END $$;

-- Выборка «что подхватить»: очередь и зависшие прогоны.
CREATE INDEX IF NOT EXISTS ix_soinv_claim ON supplier_order_invoices (recognition_status)
  WHERE recognition_status IN ('queued', 'running');

-- ============================================================
-- Журнал вызовов модели: четвёртый родитель и новый вид вызова.
-- ============================================================
ALTER TABLE ai_llm_calls
  ADD COLUMN IF NOT EXISTS supplier_order_invoice_id UUID
    REFERENCES supplier_order_invoices(id) ON DELETE CASCADE;

ALTER TABLE ai_llm_calls DROP CONSTRAINT IF EXISTS ai_llm_calls_one_parent;
ALTER TABLE ai_llm_calls ADD CONSTRAINT ai_llm_calls_one_parent
  CHECK (num_nonnulls(material_grouping_job_id, ai_job_id, ai_chat_message_id,
                      supplier_order_invoice_id) = 1);

-- Перечень видов пересоздаём как расширенный супернабор (приём 0058/0074).
ALTER TABLE ai_llm_calls DROP CONSTRAINT IF EXISTS ai_llm_calls_kind_check;
ALTER TABLE ai_llm_calls ADD CONSTRAINT ai_llm_calls_kind_check
  CHECK (kind IN (
    'batch','merge',
    'extract.items','extract.match','extract.suggest_works','extract.assign_materials',
    'extract.sweep_works','extract.sweep_material_to_work',
    'chat.agent','chat.force_final',
    'invoice.extract'
  ));

CREATE INDEX IF NOT EXISTS idx_ai_llm_calls_invoice
  ON ai_llm_calls (supplier_order_invoice_id, started_at)
  WHERE supplier_order_invoice_id IS NOT NULL;
