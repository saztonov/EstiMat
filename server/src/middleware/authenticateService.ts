import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// Сервисная аутентификация ВХОДЯЩИХ запросов от BillHub (приём событий заявок на оплату).
// Заголовок: Authorization: Api-Key <INTEGRATION_API_KEY>. Сравнение — constant-time.
// Заголовок authorization уже редактится в pino (app.ts) — секрет в логи не попадёт.
// Пустой ключ в конфиге = интеграция выключена → всегда 401.

function safeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function authenticateService(request: FastifyRequest, reply: FastifyReply) {
  const expected = config.integration.apiKey;
  if (!expected) {
    return reply.status(401).send({ error: 'Интеграция не настроена' });
  }
  const header = request.headers['authorization'];
  const prefix = 'Api-Key ';
  if (!header || !header.startsWith(prefix)) {
    return reply.status(401).send({ error: 'Не авторизован' });
  }
  const provided = header.slice(prefix.length).trim();
  if (!provided || !safeEquals(provided, expected)) {
    return reply.status(401).send({ error: 'Не авторизован' });
  }
}
