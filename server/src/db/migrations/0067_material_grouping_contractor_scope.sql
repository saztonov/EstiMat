-- 0066: умная группировка переходит на область (смета + подрядчик).
--
-- Раньше результат считался один на смету (scope_org_id всегда NULL), а отбор под подрядчика был
-- проекцией. Теперь ИИ группирует только материалы работ, назначенных подрядчику, в количествах
-- его доли, и результат принадлежит паре (смета, подрядчик). Меняется смысл scope_hash и алгоритм
-- батчинга, поэтому старые активные задания обрываем, а паузы переводим на составной ключ.
--
-- Аддитивная и идемпотентная миграция (чистый SQL, накатывается одним батчем).

-- ---- паузы: (estimate_id) -> (estimate_id, contractor_id) --------------------

ALTER TABLE material_grouping_pauses ADD COLUMN IF NOT EXISTS contractor_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_grouping_pauses_contractor_fk') THEN
    ALTER TABLE material_grouping_pauses
      ADD CONSTRAINT material_grouping_pauses_contractor_fk
      FOREIGN KEY (contractor_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Старые глобальные паузы (contractor_id IS NULL) разворачиваем на всех подрядчиков сметы: остановку
-- сохраняем для каждого, кому смета назначена. Смета без подрядчиков паузу теряет (группировки нет).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM material_grouping_pauses WHERE contractor_id IS NULL) THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_grouping_pauses_pkey') THEN
      ALTER TABLE material_grouping_pauses DROP CONSTRAINT material_grouping_pauses_pkey;
    END IF;
    INSERT INTO material_grouping_pauses (estimate_id, contractor_id, paused_at, paused_by, paused_job_id)
    SELECT DISTINCT p.estimate_id, eic.contractor_id, p.paused_at, p.paused_by, p.paused_job_id
      FROM material_grouping_pauses p
      JOIN estimate_item_contractors eic ON eic.estimate_id = p.estimate_id
     WHERE p.contractor_id IS NULL;
    DELETE FROM material_grouping_pauses WHERE contractor_id IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_grouping_pauses_pkey') THEN
    ALTER TABLE material_grouping_pauses ALTER COLUMN contractor_id SET NOT NULL;
    ALTER TABLE material_grouping_pauses
      ADD CONSTRAINT material_grouping_pauses_pkey PRIMARY KEY (estimate_id, contractor_id);
  END IF;
END $$;

-- ---- оборвать старые глобальные активные задания -----------------------------
-- План батчинга и смысл scope_hash изменились: доигрывать их новым кодом нельзя.

UPDATE material_grouping_jobs
   SET status = 'cancelled', cancel_reason = 'superseded', cancelled_at = now(),
       locked_by = NULL, locked_until = NULL
 WHERE status IN ('pending', 'running') AND scope_org_id IS NULL;

-- ---- индекс под выборку по scope ---------------------------------------------

CREATE INDEX IF NOT EXISTS idx_mgj_estimate_scope_created
  ON material_grouping_jobs (estimate_id, scope_org_id, created_at DESC);

-- ---- убрать настройку границ группировки -------------------------------------
-- Границы (вид работ/локация/тип) больше не задаются: вид работ стал affinity-подсказкой, локация
-- и тип ушли в отображение внутри блоков.

DELETE FROM app_settings WHERE key = 'material_grouping_levels';
