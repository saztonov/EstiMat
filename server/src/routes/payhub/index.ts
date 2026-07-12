import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { payhubProjectMapSchema, payhubSenderSchema } from '@estimat/shared';
import { getPayHubClient } from '../../lib/payhub/client.js';
import { PayHubApiError } from '../../lib/payhub/errors.js';

/**
 * Администрирование интеграции PayHub (только admin): справочники проектов/контрагентов PayHub,
 * сопоставление объектов EstiMat, глобальный «Отправитель РП», проверка доступности.
 */
export default async function payhubRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('admin'));

  const notConfigured = () => ({ data: [], configured: false });

  // Справочники PayHub (для селектов сопоставления).
  fastify.get('/catalog/projects', async (_request, reply) => {
    const client = getPayHubClient();
    if (!client) return notConfigured();
    try {
      return { data: await client.listProjects(), configured: true };
    } catch (e) {
      const err = e as PayHubApiError;
      return reply.status(502).send({ error: `PayHub: ${err.message}` });
    }
  });

  fastify.get('/catalog/contractors', async (_request, reply) => {
    const client = getPayHubClient();
    if (!client) return notConfigured();
    try {
      return { data: await client.listContractors(), configured: true };
    } catch (e) {
      const err = e as PayHubApiError;
      return reply.status(502).send({ error: `PayHub: ${err.message}` });
    }
  });

  // Проверка доступности PayHub.
  fastify.get('/ping', async () => {
    const client = getPayHubClient();
    if (!client) return { ok: false, configured: false };
    try {
      const r = await client.ping();
      return { ok: true, configured: true, latencyMs: r.latencyMs };
    } catch (e) {
      return { ok: false, configured: true, error: (e as Error).message };
    }
  });

  // Объекты EstiMat с текущим сопоставлением.
  fastify.get('/projects', async () => {
    const { rows } = await fastify.pool.query(
      `SELECT id, code, name, payhub_project_id, payhub_contractor_id
         FROM projects ORDER BY code`,
    );
    return { data: rows };
  });

  // Сохранить сопоставление объекта: проект PayHub + получатель.
  fastify.put<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const body = payhubProjectMapSchema.parse(request.body);
    const { rowCount } = await fastify.pool.query(
      `UPDATE projects SET payhub_project_id = $2, payhub_contractor_id = $3, updated_at = now()
        WHERE id = $1`,
      [request.params.id, body.payhubProjectId, body.payhubContractorId],
    );
    if (!rowCount) return reply.status(404).send({ error: 'Объект не найден' });
    return { data: { ok: true } };
  });

  // Глобальная настройка «Отправитель РП».
  fastify.get('/sender', async () => {
    const { rows } = await fastify.pool.query(`SELECT value FROM app_settings WHERE key = 'payhub_rp_sender'`);
    return { data: rows[0]?.value ?? null };
  });

  fastify.put('/sender', async (request) => {
    const body = payhubSenderSchema.parse(request.body);
    await fastify.pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('payhub_rp_sender', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(body)],
    );
    return { data: body };
  });
}
