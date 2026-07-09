#!/usr/bin/env bash
# Отправка события BillHub → EstiMat (обновление статуса заявки на оплату).
# Секрет — плейсхолдер; подставьте реальный INTEGRATION_API_KEY из защищённого хранилища.
set -euo pipefail

ESTIMAT_URL="${ESTIMAT_URL:-https://api.estimat.example}"
API_KEY="${INTEGRATION_API_KEY:-<INTEGRATION_API_KEY>}"

curl -sS -X POST "${ESTIMAT_URL}/api/integration/events" \
  -H "Authorization: Api-Key ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": 1,
    "eventId": "11111111-1111-1111-1111-111111111111",
    "type": "payment_request.workflow_changed",
    "externalRef": "estimat:pr:00000000-0000-0000-0000-000000000000",
    "bhRequestId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "aggregateVersion": 2,
    "occurredAt": "2026-07-10T10:00:00Z",
    "snapshot": {
      "statusCode": "approv_omts",
      "actionRequired": false,
      "requestNumber": "2026-000123",
      "requestUrl": "https://billhub.example/requests/123"
    }
  }'
# Ожидаемо: 200 {"data":{"status":"applied"}}. Повтор того же eventId → {"status":"duplicate"}.
# Если заявки ещё нет (событие раньше ответа submit) → 409, повторить позже.
