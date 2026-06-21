/**
 * Realtime-плагин: WebSocket-эндпоинт /api/realtime + потребитель Postgres LISTEN.
 *
 * Клиент подключается, проходит Origin-check и cookie-JWT auth, шлёт `subscribe_estimate`
 * (после проверки доступа к смете). Сервер рассылает события `estimate.changed`, которые
 * приходят по выделенному LISTEN-соединению (события публикуют роуты через pg_notify).
 */
import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import pg from 'pg';
import { realtimeClientMessageSchema, type EstimateChangedEvent } from '@estimat/shared';
import { config } from '../config.js';
import { authenticate } from '../middleware/authenticate.js';
import { assertEstimateAccess } from '../lib/chat/access.js';
import {
  ESTIMATE_CHANGED_CHANNEL,
  RealtimeRegistry,
  publishEstimateChanged,
} from '../lib/realtime/bus.js';

const PING_INTERVAL_MS = 25_000;

export default fp(async (fastify) => {
  await fastify.register(websocket);

  const registry = new RealtimeRegistry();

  // Публикация события (для роутов) — fire-and-forget, ошибка NOTIFY не валит мутацию.
  fastify.decorate('publishEstimateChanged', async (event: EstimateChangedEvent) => {
    try {
      await publishEstimateChanged(fastify.pool, event);
    } catch (err) {
      fastify.log.error({ err }, 'realtime: publish failed');
    }
  });

  // --- Выделенное LISTEN-соединение (не из пула) с авто-reconnect ---
  let listenClient: pg.Client | null = null;
  let closed = false;
  let reconnectDelay = 1000;

  async function startListener(): Promise<void> {
    if (closed) return;
    const client = new pg.Client({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
    });
    client.on('notification', (msg) => {
      if (msg.channel !== ESTIMATE_CHANGED_CHANNEL || !msg.payload) return;
      try {
        registry.dispatch(JSON.parse(msg.payload) as EstimateChangedEvent);
      } catch (err) {
        fastify.log.warn({ err }, 'realtime: bad notify payload');
      }
    });
    client.on('error', (err) => {
      fastify.log.error({ err }, 'realtime: LISTEN error, reconnecting');
      listenClient = null;
      try { void client.end(); } catch { /* ignore */ }
      scheduleReconnect();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${ESTIMATE_CHANGED_CHANNEL}`);
      listenClient = client;
      reconnectDelay = 1000;
      fastify.log.info('realtime: LISTEN established');
    } catch (err) {
      fastify.log.error({ err }, 'realtime: LISTEN connect failed');
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    if (closed) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    setTimeout(() => void startListener(), delay).unref?.();
  }

  await startListener();

  fastify.addHook('onClose', async () => {
    closed = true;
    if (listenClient) {
      try { await listenClient.end(); } catch { /* ignore */ }
    }
  });

  // --- WS-эндпоинт ---
  fastify.get(
    '/api/realtime',
    {
      websocket: true,
      // Origin-check (CORS не защищает WS) + cookie-JWT auth до апгрейда.
      preValidation: async (request, reply) => {
        const origin = request.headers.origin;
        if (!origin || origin !== config.cors.origin) {
          return reply.code(403).send({ error: 'Origin не разрешён' });
        }
        await authenticate(request, reply);
      },
    },
    (socket, request) => {
      const user = request.currentUser;
      const exp = request.accessTokenExp;
      let unsubscribe: (() => void) | null = null;

      // Закрыть соединение по истечении access-токена (не давать WS пережить exp).
      let expTimer: ReturnType<typeof setTimeout> | undefined;
      if (exp) {
        const ms = exp * 1000 - Date.now();
        if (ms <= 0) {
          socket.close(1008, 'token expired');
          return;
        }
        expTimer = setTimeout(() => socket.close(1008, 'token expired'), ms);
      }

      // Heartbeat ping/pong — иначе idle-соединение рвётся прокси.
      let isAlive = true;
      socket.on('pong', () => { isAlive = true; });
      const ping = setInterval(() => {
        if (!isAlive) { socket.terminate(); return; }
        isAlive = false;
        try { socket.ping(); } catch { /* ignore */ }
      }, PING_INTERVAL_MS);

      socket.on('message', async (raw: Buffer) => {
        let data: unknown;
        try { data = JSON.parse(raw.toString()); } catch { return; }
        const parsed = realtimeClientMessageSchema.safeParse(data);
        if (!parsed.success) return;
        if (unsubscribe) return; // одна активная подписка на соединение

        const { estimateId } = parsed.data;
        try {
          await assertEstimateAccess(fastify.pool, estimateId, user);
        } catch {
          socket.close(1008, 'no access');
          return;
        }
        unsubscribe = registry.subscribe(estimateId, (event) => {
          try { socket.send(JSON.stringify(event)); } catch { /* ignore */ }
        });
        try { socket.send(JSON.stringify({ type: 'subscribed', estimateId })); } catch { /* ignore */ }
      });

      socket.on('close', () => {
        clearInterval(ping);
        if (expTimer) clearTimeout(expTimer);
        if (unsubscribe) unsubscribe();
      });
    },
  );
});
