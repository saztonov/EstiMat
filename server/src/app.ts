import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { config } from './config.js';

export async function buildApp() {
  const app = Fastify({
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

  await app.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
  });

  // CORS
  await app.register(cors, {
    origin: config.cors.origin,
    credentials: true,
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

  // Multipart (file uploads)
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // Database plugin
  await app.register(import('./plugins/database.js'));

  // Routes
  await app.register(import('./routes/auth/index.js'), { prefix: '/api/auth' });
  await app.register(import('./routes/organizations/index.js'), { prefix: '/api/organizations' });
  await app.register(import('./routes/projects/index.js'), { prefix: '/api/projects' });
  await app.register(import('./routes/materials/index.js'), { prefix: '/api/materials' });
  await app.register(import('./routes/rates/index.js'), { prefix: '/api/rates' });
  await app.register(import('./routes/estimates/index.js'), { prefix: '/api/estimates' });
  await app.register(import('./routes/users/index.js'), { prefix: '/api/users' });

  // Health check
  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
