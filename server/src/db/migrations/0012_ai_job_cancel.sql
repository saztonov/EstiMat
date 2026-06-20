-- 0012: статус 'cancelled' для заданий ИИ-извлечения (возможность остановить задачу).
--   Расширяем CHECK-ограничение ai_jobs.status значением 'cancelled'.
-- Аддитивная и идемпотентная миграция.

ALTER TABLE ai_jobs DROP CONSTRAINT IF EXISTS ai_jobs_status_check;

ALTER TABLE ai_jobs
  ADD CONSTRAINT ai_jobs_status_check
  CHECK (status IN ('pending', 'running', 'ready', 'applied', 'failed', 'cancelled'));
