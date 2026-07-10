/**
 * Плагин /api/estimates: тонкий регистратор под-модулей.
 * Все роуты регистрируются в ОДНОМ контексте инкапсуляции (обычные функции,
 * не fastify.register) — hook authenticate и настройки плагина действуют как раньше.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { registerReadRoutes } from './read.js';
import { registerHistoryRoutes } from './history.js';
import { registerVorRoutes } from './vor.js';
import { registerCrudRoutes } from './crud.js';
import { registerContractorRoutes } from './contractors.js';
import { registerItemRoutes } from './items.js';
import { registerBulkRoutes } from './bulk.js';
import { registerUndoRoutes } from './undo.js';
import { registerCommentRoutes } from './comments.js';
import { registerCostTypeCipherRoutes } from './ciphers.js';

export default async function estimateRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  // Порядок вызовов сохраняет исходный порядок объявления роутов.
  registerReadRoutes(fastify);
  registerHistoryRoutes(fastify);
  registerVorRoutes(fastify);
  registerCrudRoutes(fastify);
  registerContractorRoutes(fastify);
  registerItemRoutes(fastify);
  registerBulkRoutes(fastify);
  registerUndoRoutes(fastify);
  registerCommentRoutes(fastify);
  registerCostTypeCipherRoutes(fastify);
}
