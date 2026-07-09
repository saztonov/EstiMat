// Пример стороны BillHub: доставка versioned snapshot-событий в EstiMat.
// Node 18+ (global fetch). Секрет — из env, не хардкодить.
//
//   INTEGRATION_API_KEY=... ESTIMAT_URL=https://api.estimat.example node emit-events.mjs
//
// В реальной реализации события кладутся в integration-outbox в той же транзакции, что и
// изменение заявки, а доставку выполняет воркер с ретраями/backoff. Здесь — минимальный пример.

const ESTIMAT_URL = process.env.ESTIMAT_URL ?? 'https://api.estimat.example';
const API_KEY = process.env.INTEGRATION_API_KEY;
if (!API_KEY) throw new Error('INTEGRATION_API_KEY не задан');

/** Доставка одного события с повтором при временных ошибках/409-retry. */
async function deliver(event, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${ESTIMAT_URL}/api/integration/events`, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (res.ok) return res.json();
    // 409 = «заявка не найдена, повторите позже» ИЛИ конфликт event_id — для первого повторяем.
    if (res.status === 409 || res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      continue;
    }
    throw new Error(`EstiMat отклонил событие: ${res.status}`);
  }
  throw new Error('Не удалось доставить событие после ретраев');
}

// Пример: заявка перешла на этап ОМТС (полный snapshot текущей проекции).
const event = {
  schemaVersion: 1,
  eventId: crypto.randomUUID(),
  type: 'payment_request.workflow_changed',
  externalRef: 'estimat:pr:00000000-0000-0000-0000-000000000000',
  bhRequestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  aggregateVersion: 3,
  occurredAt: new Date().toISOString(),
  snapshot: {
    statusCode: 'approv_omts',
    actionRequired: false,
    requestNumber: '2026-000123',
    requestUrl: 'https://billhub.example/requests/123',
  },
};

console.log(await deliver(event));
