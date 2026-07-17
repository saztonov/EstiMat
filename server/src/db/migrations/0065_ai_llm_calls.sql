-- 0065: журнал обмена с моделью — общий для всех контуров ИИ, а не только для группировки.
--
-- Зачем. 0064 завёл журнал вызовов для умной группировки, и он закрыл ровно её боль. Но модель
-- зовут ещё два контура: извлечение работ из РД (ai_jobs) и ИИ-чат сметчика. По ним не видно
-- ничего: ни промпта, ни ответа, ни токенов — usage приходит от провайдера и молча выбрасывается.
-- Административная вкладка «Задания ИИ» должна показывать задачи всех трёх типов в одном списке с
-- общей статистикой расхода, поэтому журнал становится общим.
--
-- Почему переименование, а не вторая таблица. Два параллельных журнала означали бы UNION в каждом
-- запросе списка и статистики, две ретенции и обязанность вечно держать схемы синхронными. Здесь
-- таблица 0064 переименовывается и получает ещё двух родителей: структура полей и данные
-- группировки сохраняются целиком.
--
-- Ровно один родитель. Подсистем три, общего предка у них нет, но полиморфная ссылка
-- (kind + id) оставила бы сирот: DELETE /api/ai/jobs/:id и retention группировки чистят задачи
-- мимо журнала. Поэтому три nullable FK с CHECK на ровно одного заполненного — целостность держит
-- БД, а не приложение.
--
-- Аддитивная и идемпотентная миграция.

-- ---- переименование журнала 0064 в общий -------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'material_grouping_llm_calls')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_llm_calls')
  THEN
    ALTER TABLE material_grouping_llm_calls RENAME TO ai_llm_calls;
    -- job_id больше не единственный родитель — имя должно называть подсистему.
    ALTER TABLE ai_llm_calls RENAME COLUMN job_id TO material_grouping_job_id;
  END IF;
END $$;

-- Таблицы могло не быть вовсе (накат с нуля на пустой базе): 0064 её создаёт, но если порядок
-- накатки когда-нибудь изменится, эта миграция не должна падать на ALTER несуществующего.
CREATE TABLE IF NOT EXISTS ai_llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_grouping_job_id UUID REFERENCES material_grouping_jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  batch_index INTEGER,
  partition_key TEXT,
  lines_count INTEGER,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'waiting_slot', 'in_progress', 'succeeded', 'failed', 'timed_out',
                      'cancelled', 'empty')),
  parse_status TEXT NOT NULL DEFAULT 'not_run'
    CHECK (parse_status IN ('not_run', 'ok', 'warnings', 'failed')),
  parse_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  groups_count INTEGER,
  system_text TEXT,
  request_text TEXT,
  response_text TEXT,
  model TEXT,
  finish_reason TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  http_status INTEGER,
  http_attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- новые родители и поля ---------------------------------------------------

ALTER TABLE ai_llm_calls
  -- Родитель у записи ровно один, поэтому NOT NULL с одного из них снимается.
  ALTER COLUMN material_grouping_job_id DROP NOT NULL;

ALTER TABLE ai_llm_calls
  -- Извлечение из РД: родитель — задание. Каскад закрывает существующий DELETE /api/ai/jobs/:id.
  ADD COLUMN IF NOT EXISTS ai_job_id UUID REFERENCES ai_jobs(id) ON DELETE CASCADE,
  -- Чат: родитель — ХОД (сообщение ассистента), а не сессия. Один ход агента делает до 8 вызовов
  -- модели, и связать их надо именно с ходом; сессия достаётся по chat_id хода.
  ADD COLUMN IF NOT EXISTS ai_chat_message_id UUID REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
  -- Провайдер известен в момент вызова. Не выводить его потом из формата id: голый 'vendor/model'
  -- у LM Studio и у OpenRouter выглядит одинаково, и любое додумывание — ложь в аудите.
  ADD COLUMN IF NOT EXISTS provider TEXT,
  -- Тексты вычищаются раньше метаданных (см. ниже), и «не сохраняли» надо отличать от
  -- «сохранили и вычистили по сроку» — иначе пустой лог выглядит поломкой.
  ADD COLUMN IF NOT EXISTS texts_purged_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_llm_calls_one_parent') THEN
    ALTER TABLE ai_llm_calls ADD CONSTRAINT ai_llm_calls_one_parent
      CHECK (num_nonnulls(material_grouping_job_id, ai_job_id, ai_chat_message_id) = 1);
  END IF;
END $$;

-- ---- этапы всех трёх контуров ------------------------------------------------

-- Имя constraint'а пережило переименование таблицы, поэтому дропаем по старому имени.
ALTER TABLE ai_llm_calls DROP CONSTRAINT IF EXISTS material_grouping_llm_calls_kind_check;
ALTER TABLE ai_llm_calls DROP CONSTRAINT IF EXISTS ai_llm_calls_kind_check;
ALTER TABLE ai_llm_calls ADD CONSTRAINT ai_llm_calls_kind_check CHECK (kind IN (
  -- группировка (0064)
  'batch', 'merge',
  -- извлечение из РД: этапы конвейера, у каждого свой промпт и своя цена
  'extract.items', 'extract.match', 'extract.suggest_works', 'extract.assign_materials',
  'extract.sweep_works', 'extract.sweep_material_to_work',
  -- чат: обычная итерация агента и вынужденный добор финального текста
  'chat.agent', 'chat.force_final'
));

-- ---- индексы под новых родителей ---------------------------------------------

-- Модалка лога и агрегат токенов в списке бьют по родителю; idx_mgllm_job (из 0064) закрывает
-- группировку и после переименования колонки продолжает работать.
CREATE INDEX IF NOT EXISTS idx_ai_llm_calls_job ON ai_llm_calls(ai_job_id, started_at)
  WHERE ai_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_llm_calls_chat_msg ON ai_llm_calls(ai_chat_message_id, started_at)
  WHERE ai_chat_message_id IS NOT NULL;

COMMENT ON TABLE ai_llm_calls IS
  'Журнал обмена с моделью по всем контурам ИИ (группировка, извлечение из РД, чат). Только для админа. Тексты запросов и ответов вычищаются через 7 дней, метаданные и токены живут вместе с задачей.';

-- ---- чат: автор хода и режим выполнения --------------------------------------

ALTER TABLE ai_chat_messages
  -- Сессии совместные: доступ к чату даёт доступ к СМЕТЕ (lib/chat/access.ts), проверки владельца
  -- нет нигде, и любой инженер продолжает чужой диалог. Автор хода не сохранялся, поэтому расход
  -- токенов было не на кого отнести — ai_chats.created_by говорит лишь о том, кто завёл сессию.
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Без настроенного провайдера чат отвечает детерминированным поиском по справочнику, НЕ вызывая
  -- модель, но пишет в model её имя — такой ход неотличим от настоящего, а его пустой журнал
  -- выглядит сбоем логирования. NULL — исторические ходы: режим для них неизвестен, не выдумываем.
  ADD COLUMN IF NOT EXISTS execution_mode TEXT
    CHECK (execution_mode IS NULL OR execution_mode IN ('llm', 'fallback'));

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_created_by ON ai_chat_messages(created_by);
