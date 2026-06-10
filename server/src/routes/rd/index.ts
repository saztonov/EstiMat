import type { FastifyInstance, FastifyReply } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { RdPortalError } from '../../plugins/rd-portal.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Рабочая документация из портала RDLOCAL (Supabase + R2), только чтение.
export default async function rdRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // Портал не настроен / id невалиден / внешняя ошибка — единые ответы.
  function portalOr503(reply: FastifyReply) {
    if (!fastify.rdPortal) {
      reply.status(503).send({ error: 'Портал РД не настроен' });
      return null;
    }
    return fastify.rdPortal;
  }

  function badId(reply: FastifyReply, id: string) {
    if (UUID_RE.test(id)) return false;
    reply.status(400).send({ error: 'Невалидный идентификатор' });
    return true;
  }

  function handlePortalError(reply: FastifyReply, err: unknown) {
    if (err instanceof RdPortalError) {
      fastify.log.error({ err }, 'RD portal error');
      return reply.status(502).send({ error: 'Портал РД недоступен' });
    }
    throw err;
  }

  // Дерево распознанных документов: объект → стадия (РД/ПД) → раздел → шифр.
  fastify.get('/tree', async (request, reply) => {
    if (!fastify.rdPortal) return { configured: false, data: [] };
    try {
      return { configured: true, data: await fastify.rdPortal.getTree() };
    } catch (err) {
      return handlePortalError(reply, err);
    }
  });

  // Файлы документа (pdf, result_md, кропы, ocr_html).
  fastify.get<{ Params: { nodeId: string } }>('/documents/:nodeId/files', async (request, reply) => {
    const portal = portalOr503(reply);
    if (!portal || badId(reply, request.params.nodeId)) return;
    try {
      return { data: await portal.getDocumentFiles(request.params.nodeId) };
    } catch (err) {
      return handlePortalError(reply, err);
    }
  });

  // Распознанный markdown документа (текстом).
  fastify.get<{ Params: { nodeId: string } }>('/documents/:nodeId/markdown', async (request, reply) => {
    const portal = portalOr503(reply);
    if (!portal || badId(reply, request.params.nodeId)) return;
    try {
      return { content: await portal.getMarkdown(request.params.nodeId) };
    } catch (err) {
      return handlePortalError(reply, err);
    }
  });

  // Подписанная ссылка на файл в R2 (pdf/картинки открываются без cookie).
  fastify.get<{ Params: { fileId: string } }>('/files/:fileId/url', async (request, reply) => {
    const portal = portalOr503(reply);
    if (!portal || badId(reply, request.params.fileId)) return;
    try {
      const result = await portal.presignFile(request.params.fileId);
      if (!result) return reply.status(404).send({ error: 'Файл не найден' });
      return result;
    } catch (err) {
      return handlePortalError(reply, err);
    }
  });
}
