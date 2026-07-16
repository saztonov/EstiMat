import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import { ZodError } from 'zod';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { createOutboxWorker } from './lib/integration/outbox-worker.js';
import { createTenderPoller } from './lib/tender/poller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '..', 'uploads');

export async function buildApp() {
  const app = Fastify({
    // За nginx reverse proxy (§3, §23): доверяем X-Forwarded-* —
    // корректный client IP для rate-limit и протокол для secure-cookies.
    trustProxy: true,
    logger: {
      level: config.isProduction ? 'info' : 'debug',
      transport: config.isProduction
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true } },
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'body.password',
        'body.currentPassword',
        'body.newPassword',
      ],
    },
  });

  // Security plugins
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
      },
    },
  });

  // CORS (раздельные домены SPA/API) — все параметры заданы явно.
  await app.register(cors, {
    origin: config.cors.origin, // адрес: только https://estimat.su10.ru (из CORS_ORIGIN), не wildcard
    credentials: true, // разрешить cookie (httpOnly JWT)
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], // дефолт @fastify/cors — лишь GET,HEAD,POST
    allowedHeaders: ['Content-Type'], // заголовки запроса; Authorization не нужен — токен в cookie
    maxAge: 86400, // время кэша preflight в браузере, сек (24 ч) — меньше лишних OPTIONS
  });

  // Cookies
  await app.register(cookie);

  // JWT
  await app.register(jwt, {
    secret: config.jwt.secret,
    cookie: {
      cookieName: 'access_token',
      signed: false,
    },
  });

  // Rate-limit. Ключ — по пользователю (sub из JWT в cookie), иначе по IP.
  // Регистрируется ПОСЛЕ cookie и jwt: keyGenerator использует request.cookies и
  // request.server.jwt. Per-user важен при общем офисном NAT — иначе 500 req/min
  // делились бы на всех. Неаутентифицированные запросы (логин/refresh) остаются
  // по IP, сохраняя брутфорс-защиту.
  await app.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const token = req.cookies?.['access_token'];
      if (token) {
        try {
          const { sub } = req.server.jwt.verify<{ sub: string }>(token);
          if (sub) return `u:${sub}`;
        } catch { /* токен невалиден/просрочен — лимитируем по IP */ }
      }
      return req.ip;
    },
  });

  // Multipart (file uploads). Глобальный лимит согласован с per-route (заявки — 50 МБ).
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  // Static files (user uploads) — только dev-фолбэк без S3.
  // В проде файлы в S3 (§15): локальный каталог не создаём (контейнер под non-root
  // не имеет прав на /app/server) и статику не монтируем — backend stateless (§4).
  if (!config.s3.enabled) {
    await mkdir(join(UPLOADS_DIR, 'projects'), { recursive: true });
    await app.register(fastifyStatic, {
      root: UPLOADS_DIR,
      prefix: '/uploads/',
      decorateReply: false,
    });
  }

  // Database plugin
  await app.register(import('./plugins/database.js'));

  // S3-хранилище файлов (Cloud.ru) — опционально, по env S3_*
  await app.register(import('./plugins/s3.js'));

  // RD portal (RDLOCAL, read-only) — опционально, по env RD_*
  await app.register(import('./plugins/rd-portal.js'));

  // Realtime: WS /api/realtime + LISTEN/NOTIFY (декорирует publishEstimateChanged).
  // Регистрируется до роутов, которые публикуют события.
  await app.register(import('./plugins/realtime.js'));

  // Глобальный обработчик ошибок. Хендлеры используют schema.parse(request.body)
  // без try/catch. ВАЖНО: setErrorHandler должен вызываться ДО регистрации роутов —
  // роут захватывает обработчик своего контекста в момент регистрации, и хендлер,
  // поставленный после, для него не срабатывает (ZodError уходил бы дефолтом как 500).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      const message = error.issues
        .map((i) => `${i.path.join('.') || 'поле'}: ${i.message}`)
        .join('; ');
      return reply.status(400).send({ error: message });
    }
    // Нарушение уникальности PostgreSQL (unique_violation) — страховка от гонки
    // check-then-insert: параллельные запросы проходят прекек, но упираются в UNIQUE-индекс.
    if ((error as { code?: string }).code === '23505') {
      return reply.status(409).send({ error: 'Запись с такими данными уже существует' });
    }
    // RAISE EXCEPTION из валидационных триггеров БД (validate_item_contractor и др.) —
    // сообщения уже написаны для пользователя, отдаём как 400, а не «Внутренняя ошибка сервера».
    if ((error as { code?: string }).code === 'P0001') {
      return reply.status(400).send({ error: error.message });
    }
    // Клиентские ошибки (rate-limit 429, и пр.) — отдаём как есть с тем же статусом.
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    request.log.error({ err: error }, 'Необработанная ошибка');
    return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  // Исходящая очередь команд в BillHub (создаём до роутов — payment-requests дёргает fast-path).
  const outbox = createOutboxWorker(app);
  app.decorate('outbox', outbox);
  app.addHook('onClose', async () => {
    await outbox.stop();
  });

  // Фоновый опрос результатов тендеров с портала СУ-10 (самотормозится при выключенном рубильнике).
  const tenderPoller = createTenderPoller(app);
  app.addHook('onClose', async () => {
    await tenderPoller.stop();
  });

  // Routes
  await app.register(import('./routes/auth/index.js'), { prefix: '/api/auth' });
  await app.register(import('./routes/organizations/index.js'), { prefix: '/api/organizations' });
  await app.register(import('./routes/projects/index.js'), { prefix: '/api/projects' });
  await app.register(import('./routes/materials/index.js'), { prefix: '/api/materials' });
  await app.register(import('./routes/units/index.js'), { prefix: '/api/units' });
  await app.register(import('./routes/room-types/index.js'), { prefix: '/api/room-types' });
  await app.register(import('./routes/rates/index.js'), { prefix: '/api/rates' });
  await app.register(import('./routes/rates-v2/index.js'), { prefix: '/api/rates-v2' });
  await app.register(import('./routes/estimates/index.js'), { prefix: '/api/estimates' });
  await app.register(import('./routes/estimate-items/index.js'), { prefix: '/api/estimate-items' });
  await app.register(import('./routes/contractors/index.js'), { prefix: '/api/contractors' });
  await app.register(import('./routes/material-requests/index.js'), { prefix: '/api/material-requests' });
  await app.register(import('./routes/requests/index.js'), { prefix: '/api/requests' });
  await app.register(import('./routes/supplier-orders/index.js'), { prefix: '/api/supplier-orders' });
  await app.register(import('./routes/procurement/index.js'), { prefix: '/api/procurement' });
  await app.register(import('./routes/suppliers/index.js'), { prefix: '/api/suppliers' });
  await app.register(import('./routes/payhub/index.js'), { prefix: '/api/payhub' });
  await app.register(import('./routes/payment-requests/index.js'), { prefix: '/api/payment-requests' });
  await app.register(import('./routes/integration/index.js'), { prefix: '/api/integration' });
  await app.register(import('./routes/notifications/index.js'), { prefix: '/api/notifications' });
  await app.register(import('./routes/users/index.js'), { prefix: '/api/users' });
  await app.register(import('./routes/uploads/index.js'), { prefix: '/api/uploads' });
  await app.register(import('./routes/rd/index.js'), { prefix: '/api/rd' });
  await app.register(import('./routes/settings/index.js'), { prefix: '/api/settings' });
  await app.register(import('./routes/ai-prompts/index.js'), { prefix: '/api/settings/ai-prompts' });
  await app.register(import('./routes/llm/index.js'), { prefix: '/api/llm' });
  await app.register(import('./routes/ai/index.js'), { prefix: '/api/ai' });
  await app.register(import('./routes/ai-chat/index.js'), { prefix: '/api/ai-chat' });
  await app.register(import('./routes/material-grouping/index.js'), { prefix: '/api/material-grouping' });

  // Запуск фоновой доставки команд в BillHub (самотормозится при выключенном рубильнике).
  outbox.start();
  // Запуск опроса тендеров (самотормозится при выключенном TENDER_SYNC_ENABLED).
  tenderPoller.start();

  // Health endpoints (§5) — без auth и без rate-limit, на корне для nginx/uptime.
  app.get('/health/live', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/health/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await app.pool.query('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      app.log.error({ err }, 'Readiness check failed');
      return reply.status(503).send({ status: 'unavailable' });
    }
  });
  // Совместимость со старым health-check — без rate-limit (его дёргает мониторинг).
  app.get('/api/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  return app;
}
