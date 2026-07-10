---
name: estimat-billhub
description: Контракт двусторонней интеграции EstiMat ↔ BillHub — создание заявок на оплату по РП из EstiMat и возврат статусов/оплаты обратно. Использовать при реализации стороны BillHub (сервисный API /api/external/v1 и обратные события) или при отладке обмена.
---

# Интеграция EstiMat ↔ BillHub (заявки на оплату по РП)

EstiMat — **инициатор**: подрядчик оформляет заявку на оплату, которая создаётся в BillHub
(тип `contractor`, цепочка согласования Штаб → ОМТС → РП). BillHub — **владелец жизненного
цикла**: согласование, доработка, документы, распределительное письмо (РП), оплата. Эти
изменения BillHub возвращает в EstiMat событиями.

```
EstiMat ──(создать заявку на оплату)──▶ BillHub /api/external/v1/payment-requests/import → confirm files → submit
EstiMat ◀──(статусы/доработка/РП/оплата)── BillHub POST {ESTIMAT}/api/integration/events
```

Направление 1 (EstiMat → BillHub) реализовано на стороне EstiMat (клиент
`server/src/lib/billhub/client.ts`). Направление 2 (BillHub → EstiMat) реализовано на стороне
EstiMat (приёмник `server/src/routes/integration/index.ts`). **Эта спецификация описывает, что
нужно реализовать на стороне BillHub.**

## Аутентификация (v1: Api-Key поверх HTTPS)

Два независимых секрета, по одному на направление. HMAC в v1 не используется — только Api-Key +
HTTPS + идемпотентность.

| Направление | Куда | Заголовок |
|---|---|---|
| EstiMat → BillHub | BillHub `/api/external/v1/*` | `Authorization: Api-Key <BILLHUB_API_TOKEN>` |
| BillHub → EstiMat | EstiMat `/api/integration/events` | `Authorization: Api-Key <INTEGRATION_API_KEY>` |

Сравнение ключей — constant-time (`crypto.timingSafeEqual`). Секреты — только из env, не логировать.

## Направление 1. EstiMat → BillHub (реализовать в BillHub)

Все пути под префиксом `/api/external/v1`. Сервисный принципал `source_system='estimat'`.

### 1.1 Справочники (для формы заявки в EstiMat)
Отдавать ТОЛЬКО активные записи. Объект/контрагент НЕ выбираются — BillHub резолвит их
server-side из `projectCode` + `contractorInn` (см. 1.2).

- `GET /references/suppliers` → `{ "data": [{ "id", "name", "inn", "securityStatus" }] }`
- `GET /references/shipping-options` → `{ "data": [{ "id", "value" }] }` (это `payment_request_field_options` с `field_code='shipping'`)
- `GET /references/document-types` → `{ "data": [{ "id", "name", "category" }] }`

### 1.2 Создание заявки: import-session → confirm files → submit
**Только `submit` создаёт `payment_request` и стартует Штаб.** Счёт (≥1 подтверждённый документ)
и положительная сумма обязательны до submit.

1. `POST /payment-requests/import`
   ```json
   { "externalRef": "estimat:pr:<uuid>", "payloadHash": "<sha256>",
     "request": { "requestType": "contractor", "projectCode": "АБ0123", "contractorInn": "7701234567",
       "contractorName": "ООО ...", "supplierId": "<bh>", "supplierInn": "...",
       "shippingConditionId": "<bh>", "deliveryDays": 10, "deliveryDaysType": "working",
       "invoiceAmount": 125000.00, "comment": "..." } }
   ```
   → `{ "importId": "<uuid>", "replay": false }`.
   **Идемпотентность:** уникальный индекс `(source_system, external_ref)`. Тот же `externalRef` +
   тот же `payloadHash` → вернуть исходный результат (`replay:true`). Тот же `externalRef` +
   другой hash → `409 { "error": { "code": "idempotency_conflict" } }`. Произвольный 409
   «усыновлением» не считать.

2. `POST /payment-requests/import/{importId}/files/upload-url` `{ "fileName", "contentType" }`
   → `{ "uploadUrl", "fileKey" }` (presigned PUT в S3 BillHub). EstiMat кладёт байты PUT-ом.

3. `POST /payment-requests/import/{importId}/files/confirm`
   `{ "fileKey", "documentTypeId", "fileName", "fileSize", "mimeType" }` → `{ "fileId" }`.

4. `POST /payment-requests/import/{importId}/submit`
   → `{ "requestId", "number", "url", "aggregateVersion", "replay" }`.
   Здесь BillHub маппит `projectCode → construction_sites` и `contractorInn → counterparties`,
   валидирует комплект, создаёт `payment_requests` (тип `contractor`), считает `total_files` сам.

### 1.3 Reconciliation
`GET /payment-requests/by-ref/{externalRef}` → полный snapshot текущей проекции (см. формат 2.2).
EstiMat дёргает при неоднозначном таймауте / пропуске версии / периодической сверке.

## Направление 2. BillHub → EstiMat (эмитить из BillHub)

BillHub при КАЖДОМ изменении заявки (согласование, доработка, документ, связь с РП, оплата)
кладёт событие в **отдельный integration-outbox** (не переключать существующий audit-handler —
потеряется аудит) и доставляет `POST {ESTIMAT}/api/integration/events` c `Authorization: Api-Key`.

### 2.1 Конверт события
Каждое событие несёт **монотонную `aggregateVersion`** и **полный snapshot** проекции — EstiMat
применяет только более новую версию (защита от переупорядочивания), а по `eventId` — идемпотентно.

```json
{
  "schemaVersion": 1,
  "eventId": "<uuid, уникален>",
  "type": "payment_request.workflow_changed",
  "externalRef": "estimat:pr:<uuid>",
  "bhRequestId": "<uuid заявки в BillHub>",
  "aggregateVersion": 7,
  "occurredAt": "2026-07-10T10:00:00Z",
  "correlationId": "<опц>",
  "snapshot": { /* см. 2.2 */ }
}
```

Типы (`type`): `payment_request.workflow_changed`, `payment_request.document_attached`,
`payment_request.rp_changed`, `payment_request.rp_unlinked`, `payment_request.payment_summary_changed`.

### 2.2 Snapshot (полное текущее состояние проекции)
```json
{
  "statusCode": "approv_omts",           // approv_shtab|approv_omts|approv_rp|approved|revision|rejected|withdrawn
  "actionRequired": false,               // true при revision (нужна доработка в BillHub)
  "revisionComment": null,
  "requestNumber": "2026-000123",
  "requestUrl": "https://billhub/.../123",// deep-link для доработки
  "rpNumber": "РП-000045",               // из актуальных rp_letters, НЕ только legacy dp_*
  "rpDate": "2026-07-09",
  "paidStatus": "partially_paid",        // not_paid|partially_paid|paid (может откатываться назад)
  "totalPaid": 60000.00,
  "lastPaymentDate": "2026-07-10",
  "documents": [{ "documentId": "<opaque>", "documentType": "Счёт", "fileName": "invoice.pdf", "mimeType": "application/pdf", "fileSize": 12345 }]
}
```

**Семантика применения — REPLACE, не COALESCE.** Snapshot всегда содержит ПОЛНОЕ текущее
состояние проекции, поэтому EstiMat перезаписывает поля значениями из snapshot; `null` в snapshot
**очищает** поле. Примеры: `rp_unlinked` присылает `rpNumber:null` → номер РП очищается;
завершение доработки присылает `revisionComment:null` → комментарий очищается; `paidStatus`/
`totalPaid` могут откатываться назад (paid → partially_paid). Исключения (защищены на приёмнике):
идентичность заявки `requestNumber`/`requestUrl` — set-once (не затираются пустым), а `totalPaid`
приводится к `0` вместо `NULL` (поле NOT NULL). Поэтому BillHub ОБЯЗАН слать полный snapshot в
каждом событии, а не только изменившиеся поля.

### 2.3 Ответы EstiMat
- `200 { "data": { "status": "applied" | "ignored_stale" | "duplicate" } }` — принято.
- `409 { "error": "Заявка не найдена, повторите позже" }` — событие пришло раньше ответа submit;
  BillHub должен **повторить позже** (не терять). Также `409` при том же `eventId` с другим телом.

## Идемпотентность и ретраи — сводка
- **Пользовательский POST в EstiMat** — по `create_request_id` (клиентский ключ).
- **EstiMat → BillHub** — по `external_ref` (`estimat:pr:<uuid>`) + `payloadHash`.
- **BillHub → EstiMat** — по `event_id`; порядок — по `aggregateVersion`.
- Ретраи — экспоненциальный backoff; постоянные 4xx (кроме 409-retry) → dead-letter.

## Примеры
См. `examples/` — отправка события в EstiMat (`curl` и Node), проверка приёма.
Секреты в примерах — плейсхолдеры (`<INTEGRATION_API_KEY>`), реальные значения не коммитить.
