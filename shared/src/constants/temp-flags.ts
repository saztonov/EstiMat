// TODO(temp): УДАЛИТЬ ВЕСЬ ФАЙЛ после завершения тестов закупок (отдельным коммитом).
// Временный режим: admin может удалить заказ поставщику (kind='sourcing') в ЛЮБОМ статусе,
// включая awarded/approval — вместе с предложениями, счетами, ценами, графиком и платежами.
// Только для тестовых/ошибочных заказов. Сервер и в этом режиме блокирует тендеры
// (procurement_method='tender'), внешний тендер (tender_portal_id) и незавершённый outbox.
// Точки использования — grep по имени константы (server: orderDeletionDenial;
// client: PurchasesRegistryTab, SupplierOrderModal).
export const TEMP_ALLOW_ANY_STATUS_ORDER_DELETE = true;
