/**
 * Нагрузочный тест realtime + лавины refetch (см. план «масштаб совместной работы»).
 *
 * Что проверяет (главное — НЕ сам WS, а его последствие):
 *  - N одновременных WebSocket-клиентов подписываются на одну смету (с Origin + cookie);
 *  - всплеск мутаций по строке сметы порождает события estimate_changed;
 *  - каждый клиент, как реальный фронт, на событие (с debounce 300мс) делает полный
 *    GET /estimates/:id — это и есть «лавина refetch», главный риск масштаба;
 *  - параллельный пинг /health/ready (SELECT 1 через пул) косвенно ловит исчерпание
 *    пула: рост его latency = соединения ждут (аналог pool.waitingCount).
 *
 * Запуск (сервер и БД уже подняты):
 *   cd server
 *   API=http://localhost:3000 ORIGIN=http://localhost:5173 \
 *   EMAIL=admin@example.com PASSWORD=*** ESTIMATE_ID=<uuid> \
 *   CLIENTS=100 BURST=20 BURST_INTERVAL_MS=100 \
 *   npx tsx scripts/loadtest-realtime.ts
 *
 * Для проверки per-user rate-limit можно поднять несколько копий с разными EMAIL.
 */
import WebSocket from 'ws';

const API = process.env.API ?? 'http://localhost:3000';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173';
const EMAIL = process.env.EMAIL ?? '';
const PASSWORD = process.env.PASSWORD ?? '';
const ESTIMATE_ID = process.env.ESTIMATE_ID ?? '';
const ITEM_ID = process.env.ESTIMATE_ITEM_ID ?? '';
const CLIENTS = Number(process.env.CLIENTS ?? '100');
const BURST = Number(process.env.BURST ?? '20');
const BURST_INTERVAL_MS = Number(process.env.BURST_INTERVAL_MS ?? '100');
const REFETCH_DEBOUNCE_MS = 300; // как в useEstimateRealtime

if (!EMAIL || !PASSWORD || !ESTIMATE_ID) {
  console.error('Заданы не все обязательные env: EMAIL, PASSWORD, ESTIMATE_ID');
  process.exit(1);
}

const wsUrl = `${API.replace(/^http/, 'ws')}/api/realtime`;

// ---- утилиты ----
function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function summary(name: string, values: number[], unit = 'мс'): void {
  if (values.length === 0) { console.log(`  ${name}: нет данных`); return; }
  const sum = values.reduce((a, b) => a + b, 0);
  console.log(
    `  ${name}: n=${values.length} avg=${(sum / values.length).toFixed(0)}${unit} ` +
    `p50=${pct(values, 50).toFixed(0)} p95=${pct(values, 95).toFixed(0)} max=${Math.max(...values).toFixed(0)}${unit}`,
  );
}

// Логин → cookie access_token для последующих HTTP/WS запросов.
async function login(): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${res.status}: ${await res.text()}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  const access = cookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('access_token='));
  if (!access) throw new Error('В ответе логина нет access_token cookie');
  return access; // вид: "access_token=eyJ..."
}

// ---- метрики ----
const refetchLatency: number[] = [];
const refetchSizeKb: number[] = [];
const mutationLatency: number[] = [];
const healthLatency: number[] = [];
let wsConnected = 0;
let wsSubscribed = 0;
let wsErrors = 0;
let eventsReceived = 0;
let count429 = 0;
let count409 = 0;

async function refetchEstimate(cookie: string): Promise<void> {
  const t = performance.now();
  try {
    const res = await fetch(`${API}/api/estimates/${ESTIMATE_ID}`, { headers: { Cookie: cookie, Origin: ORIGIN } });
    if (res.status === 429) { count429++; return; }
    const text = await res.text();
    refetchLatency.push(performance.now() - t);
    refetchSizeKb.push(text.length / 1024);
  } catch { /* считаем как пропуск */ }
}

// Один WS-клиент: подключиться, подписаться, на событие — debounce → refetch (как фронт).
function startClient(cookie: string): WebSocket {
  const ws = new WebSocket(wsUrl, { headers: { Origin: ORIGIN, Cookie: cookie } });
  let debounce: ReturnType<typeof setTimeout> | undefined;
  ws.on('open', () => {
    wsConnected++;
    ws.send(JSON.stringify({ type: 'subscribe_estimate', estimateId: ESTIMATE_ID }));
  });
  ws.on('message', (raw: Buffer) => {
    let data: { type?: string } = {};
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (data.type === 'subscribed') { wsSubscribed++; return; }
    // событие estimate_changed → схлопываем пачку и делаем один refetch
    eventsReceived++;
    clearTimeout(debounce);
    debounce = setTimeout(() => void refetchEstimate(cookie), REFETCH_DEBOUNCE_MS);
  });
  ws.on('error', () => { wsErrors++; });
  return ws;
}

// Периодический пинг health/ready — индикатор насыщения пула соединений.
function startHealthProbe(): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    const t = performance.now();
    try {
      await fetch(`${API}/health/ready`);
      healthLatency.push(performance.now() - t);
    } catch { /* недоступность тоже сигнал */ }
  }, 250);
}

// Всплеск мутаций: меняем quantity у одной строки → поток item_updated событий.
async function runBurst(cookie: string, itemId: string, baseQty: number): Promise<void> {
  for (let i = 0; i < BURST; i++) {
    const t = performance.now();
    try {
      const res = await fetch(`${API}/api/estimates/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ quantity: baseQty + (i % 2 === 0 ? 0.001 : 0.002) }),
      });
      if (res.status === 429) count429++;
      else if (res.status === 409) count409++;
      else mutationLatency.push(performance.now() - t);
    } catch { /* пропуск */ }
    await new Promise((r) => setTimeout(r, BURST_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  console.log(`Логин ${EMAIL}…`);
  const cookie = await login();

  // Определяем строку для всплеска и её текущее quantity.
  let itemId = ITEM_ID;
  let baseQty = 1;
  {
    const res = await fetch(`${API}/api/estimates/${ESTIMATE_ID}`, { headers: { Cookie: cookie, Origin: ORIGIN } });
    if (!res.ok) throw new Error(`Не удалось загрузить смету: ${res.status}`);
    const body = await res.json() as { data?: { items?: { id: string; quantity: string }[] } };
    const items = body.data?.items ?? [];
    if (!itemId) {
      if (items.length === 0) throw new Error('В смете нет строк — задайте ESTIMATE_ITEM_ID или наполните смету');
      itemId = items[0].id;
      baseQty = Number(items[0].quantity) || 1;
    } else {
      baseQty = Number(items.find((it) => it.id === itemId)?.quantity ?? 1) || 1;
    }
    console.log(`Смета: строк ${items.length}, размер ответа ${(JSON.stringify(body).length / 1024).toFixed(1)} КБ`);
  }

  console.log(`Поднимаем ${CLIENTS} WS-клиентов…`);
  const clients: WebSocket[] = [];
  for (let i = 0; i < CLIENTS; i++) {
    clients.push(startClient(cookie));
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 50)); // не «штормить» upgrade
  }
  await new Promise((r) => setTimeout(r, 2000)); // дать подписаться
  console.log(`Подключено ${wsConnected}/${CLIENTS}, подписано ${wsSubscribed}`);

  const probe = startHealthProbe();
  console.log(`Всплеск: ${BURST} мутаций строки ${itemId} с интервалом ${BURST_INTERVAL_MS}мс…`);
  await runBurst(cookie, itemId, baseQty);

  // Ждём, пока докатятся события и завершатся refetch'и.
  await new Promise((r) => setTimeout(r, REFETCH_DEBOUNCE_MS + 3000));
  clearInterval(probe);
  clients.forEach((ws) => { try { ws.close(); } catch { /* ignore */ } });

  console.log('\n=== Итоги ===');
  console.log(`WS: подключено ${wsConnected}, подписано ${wsSubscribed}, ошибок ${wsErrors}, событий получено ${eventsReceived}`);
  console.log(`HTTP: 429 (rate-limit) ${count429}, 409 (конфликт) ${count409}`);
  summary('Мутации (PUT)', mutationLatency);
  summary('Лавина refetch (GET сметы)', refetchLatency);
  summary('Размер ответа сметы', refetchSizeKb, 'КБ');
  summary('health/ready (индикатор пула)', healthLatency);
  console.log(
    `\nЛавина: на ${BURST} мутаций пришлось ~${refetchLatency.length} полных GET сметы ` +
    `(≈${(refetchSizeKb.reduce((a, b) => a + b, 0)).toFixed(0)} КБ трафика).`,
  );
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
