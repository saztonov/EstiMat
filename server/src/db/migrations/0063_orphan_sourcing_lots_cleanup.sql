-- 0063: разовая чистка осиротевших закупочных лотов (supplier_orders.kind='sourcing').
--
-- Лот связан с заявкой ТОЛЬКО через позиции (supplier_orders.request_id для kind='sourcing'
-- запрещён constraint'ом, см. 0054). Удаление заявки до этого релиза удаляло позиции лота, но
-- не сам лот — в реестре закупок оставались пустые строки, которые нечем убрать из интерфейса
-- (удаление лота разрешено только на стадии 'forming', отмена — только 'sourcing').
--
-- Чистим узко — только заведомо мёртвые записи:
--   * без единой позиции;
--   * терминальная стадия ('cancelled'/'no_award') — активные и присуждённые не трогаем;
--   * без тендера на портале и без незавершённых команд integration_outbox: у outbox нет FK на
--     лот, воркер не найдёт удалённый лот и пометит команду доставленной, оставив тендер жить
--     на портале;
--   * без предложений с файлами: SQL не может удалить объекты из S3, осиротить их нельзя.
-- Пустые черновики ('forming') легитимны (снабжение убрало позиции вручную) и удаляются кнопкой.
--
-- Идемпотентно: повторный запуск не находит строк. Один батч, чистый SQL — совместимо
-- с deploy-estimat --migrate.

-- Журнал до удаления (audit_log без FK на лот — запись переживёт удаление).
INSERT INTO audit_log (entity_type, entity_id, action, user_id, changes, project_id)
SELECT 'supplier_order', so.id, 'deleted', NULL,
       jsonb_build_object('reason', 'orphan_cleanup', 'sourcing_status', so.sourcing_status,
                          'order_no', so.order_no),
       so.project_id
  FROM supplier_orders so
 WHERE so.kind = 'sourcing'
   AND so.sourcing_status IN ('cancelled', 'no_award')
   AND so.tender_portal_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM supplier_order_items soi WHERE soi.order_id = so.id)
   AND NOT EXISTS (SELECT 1 FROM supplier_order_offers o
                    WHERE o.order_id = so.id AND o.file_key IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM integration_outbox o
                    WHERE o.aggregate_type = 'supplier_order' AND o.aggregate_id = so.id
                      AND o.status IN ('queued', 'retry_wait', 'waiting_config'));

DELETE FROM supplier_orders so
 WHERE so.kind = 'sourcing'
   AND so.sourcing_status IN ('cancelled', 'no_award')
   AND so.tender_portal_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM supplier_order_items soi WHERE soi.order_id = so.id)
   AND NOT EXISTS (SELECT 1 FROM supplier_order_offers o
                    WHERE o.order_id = so.id AND o.file_key IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM integration_outbox o
                    WHERE o.aggregate_type = 'supplier_order' AND o.aggregate_id = so.id
                      AND o.status IN ('queued', 'retry_wait', 'waiting_config'));
