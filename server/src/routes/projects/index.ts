/**
 * Плагин /api/projects: тонкий регистратор под-модулей.
 * Все роуты регистрируются в ОДНОМ контексте инкапсуляции (обычные функции,
 * не fastify.register) — hook authenticate и настройки плагина действуют как раньше.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { registerCoreRoutes } from './core.js';
import { registerCoverRoutes } from './covers.js';
import { registerEstimateRoutes } from './estimate.js';
import { registerLocationRoutes } from './locations.js';
import { registerCipherRoutes } from './ciphers.js';

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  registerCoreRoutes(fastify);
  registerCoverRoutes(fastify);
  registerEstimateRoutes(fastify);
  registerLocationRoutes(fastify);
  registerCipherRoutes(fastify);
}
