import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createChatSessionSchema,
  sendChatMessageSchema,
  aiChatApplySchema,
  applySectionSchema,
} from '@estimat/shared';
import type { ChatMessage, ChatSession, ChatStep, ChatCard } from '@estimat/shared';
import { config } from '../../config.js';
import type { SectionScope } from '../../lib/extract/types.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { runAgentTurn } from '../../lib/chat/agent.js';
import { loadLlmRuntime, resolveLlmEndpoint, type ResolvedEndpoint } from '../../lib/llm/endpoint.js';
import { withLmStudioSlot } from '../../lib/llm/limiter.js';
import { resolveChatModel, resolveQwenNoThink } from '../../lib/llm/settings.js';
import { CHAT_SCOPE_NOTE } from '../../lib/chat/prompt.js';
import { applySelected, applySection, type ApplyContext } from '../../lib/chat/apply.js';
import { hasPgTrgm, searchCatalogWorks, isScopeActive, CHAT_CATALOG_MODE } from '../../lib/chat/search.js';
import type { AgentContext, ChatUser } from '../../lib/chat/types.js';
import { randomUUID } from 'node:crypto';
import { makeEstimateEvent } from '../../lib/realtime/bus.js';

// Реестр выполняющихся ходов агента (AbortController на сообщение). Корректно
// при одном инстансе API (single-VPS). Переходы статуса условные (WHERE status=...).
const runningChats = new Map<string, AbortController>();

function chatUser(u: { id: string; orgId: string | null; role: ChatUser['role'] }): ChatUser {
  return { id: u.id, orgId: u.orgId, role: u.role };
}


function mapSession(r: any): ChatSession {
  return {
    id: r.id,
    estimateId: r.estimate_id,
    title: r.title ?? null,
    status: r.status,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

function mapMessage(r: any): ChatMessage {
  return {
    id: r.id,
    chatId: r.chat_id,
    role: r.role,
    status: r.status,
    content: r.content ?? null,
    model: r.model ?? null,
    steps: (r.steps as ChatStep[]) ?? [],
    cards: (r.cards as ChatCard[]) ?? [],
    error: r.error ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

// Фоновый ход агента: крутит tool-loop, по шагам пишет прогресс, в конце — текст.
async function runChatTurn(
  fastify: FastifyInstance,
  params: {
    assistantId: string;
    userMsgId: string;
    chatId: string;
    estimateId: string;
    projectId: string;
    user: ChatUser;
    userText: string;
    endpoint: ResolvedEndpoint;
    noThink: boolean;
    sectionScope?: SectionScope;
  },
): Promise<void> {
  const { assistantId, userMsgId, chatId, estimateId, projectId, user, userText, endpoint, noThink, sectionScope } =
    params;
  const controller = new AbortController();
  runningChats.set(assistantId, controller);
  try {
    const mode = CHAT_CATALOG_MODE;
    const [hasTrgm, hist] = await Promise.all([
      hasPgTrgm(fastify.pool),
      fastify.pool.query(
        `SELECT role, content FROM ai_chat_messages
         WHERE chat_id = $1 AND status = 'done' AND id NOT IN ($2, $3) AND role IN ('user','assistant')
         ORDER BY created_at`,
        [chatId, assistantId, userMsgId],
      ),
    ]);

    const ctx: AgentContext = {
      db: fastify.pool,
      estimateId,
      projectId,
      chatId,
      user,
      catalogMode: mode,
      sectionScope,
      hasTrgm,
      signal: controller.signal,
    };

    const history = hist.rows
      .filter((m) => typeof m.content === 'string' && m.content)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));

    const runTurn = () =>
      runAgentTurn({
        llm: {
          apiKey: endpoint.apiKey,
          model: endpoint.model,
          baseUrl: endpoint.baseUrl,
          signal: controller.signal,
          maxTokens: endpoint.maxTokens,
        },
        history,
        userText,
        ctx,
        noThink,
        scopeNote: isScopeActive(sectionScope) ? CHAT_SCOPE_NOTE : undefined,
        onStep: async (steps, cards) => {
          await fastify.pool
            .query(
              `UPDATE ai_chat_messages SET steps = $2::jsonb, cards = $3::jsonb
               WHERE id = $1 AND status = 'running'`,
              [assistantId, JSON.stringify(steps), JSON.stringify(cards)],
            )
            .catch(() => {});
        },
      });
    // У LM Studio (Qwen) worker=1 — сериализуем тяжёлые ходы через слот.
    const result = endpoint.isLmStudio ? await withLmStudioSlot(runTurn) : await runTurn();

    await fastify.pool.query(
      `UPDATE ai_chat_messages
       SET content = $2, steps = $3::jsonb, cards = $4::jsonb, status = 'done'
       WHERE id = $1 AND status = 'running'`,
      [assistantId, result.content, JSON.stringify(result.steps), JSON.stringify(result.cards)],
    );
  } catch (err) {
    if (controller.signal.aborted) {
      await fastify.pool
        .query(`UPDATE ai_chat_messages SET status = 'cancelled' WHERE id = $1 AND status = 'running'`, [assistantId])
        .catch(() => {});
    } else {
      fastify.log.error({ err, assistantId }, 'ai chat turn failed');
      await fastify.pool
        .query(`UPDATE ai_chat_messages SET status = 'failed', error = $2 WHERE id = $1 AND status = 'running'`, [
          assistantId,
          err instanceof Error ? err.message : String(err),
        ])
        .catch(() => {});
    }
  } finally {
    runningChats.delete(assistantId);
  }
}

export default async function aiChatRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // Recovery: «зависшие» running-сообщения после рестарта API → failed.
  fastify.pool
    .query(
      `UPDATE ai_chat_messages SET status = 'failed', error = 'Прервано (перезапуск сервера)'
       WHERE status = 'running' AND updated_at < now() - interval '15 minutes'`,
    )
    .catch((err) => fastify.log.error({ err }, 'ai chat startup cleanup failed'));

  async function loadChat(chatId: string): Promise<{ id: string; estimateId: string; projectId: string } | null> {
    const { rows } = await fastify.pool.query(
      `SELECT c.id, c.estimate_id, e.project_id
       FROM ai_chats c JOIN estimates e ON e.id = c.estimate_id WHERE c.id = $1`,
      [chatId],
    );
    if (!rows.length) return null;
    return { id: rows[0].id, estimateId: rows[0].estimate_id, projectId: rows[0].project_id };
  }

  // POST /api/ai-chat/sessions — создать сессию
  fastify.post('/sessions', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createChatSessionSchema.parse(request.body);
    try {
      await assertEstimateAccess(fastify.pool, body.estimateId, chatUser(request.currentUser));
    } catch (err) {
      if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }
    const { rows } = await fastify.pool.query(
      `INSERT INTO ai_chats (estimate_id, created_by) VALUES ($1, $2) RETURNING *`,
      [body.estimateId, request.currentUser.id],
    );
    return reply.status(201).send({ data: mapSession(rows[0]) });
  });

  // GET /api/ai-chat/sessions?estimateId= — список сессий сметы
  fastify.get('/sessions', async (request, reply) => {
    const { estimateId } = request.query as { estimateId?: string };
    if (!estimateId) return reply.status(400).send({ error: 'estimateId обязателен' });
    try {
      await assertEstimateAccess(fastify.pool, estimateId, chatUser(request.currentUser));
    } catch (err) {
      if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }
    const { rows } = await fastify.pool.query(
      `SELECT * FROM ai_chats WHERE estimate_id = $1 AND status = 'active' ORDER BY updated_at DESC`,
      [estimateId],
    );
    return { data: rows.map(mapSession) };
  });

  // GET /api/ai-chat/sessions/:id/messages — история сообщений (поллинг)
  fastify.get<{ Params: { id: string } }>('/sessions/:id/messages', async (request, reply) => {
    const chat = await loadChat(request.params.id);
    if (!chat) return reply.status(404).send({ error: 'Чат не найден' });
    try {
      await assertEstimateAccess(fastify.pool, chat.estimateId, chatUser(request.currentUser));
    } catch (err) {
      if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }
    const { rows } = await fastify.pool.query(
      `SELECT * FROM ai_chat_messages WHERE chat_id = $1 ORDER BY created_at`,
      [request.params.id],
    );
    return { data: rows.map(mapMessage) };
  });

  // POST /api/ai-chat/sessions/:id/messages — отправить сообщение, запустить ход агента
  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/messages',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const body = sendChatMessageSchema.parse(request.body);
      const chat = await loadChat(request.params.id);
      if (!chat) return reply.status(404).send({ error: 'Чат не найден' });
      try {
        await assertEstimateAccess(fastify.pool, chat.estimateId, chatUser(request.currentUser));
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }

      // Выбранная модель и её эндпоинт (OpenRouter/прокси или собственный сервер LM Studio).
      const qualifiedModel = await resolveChatModel(fastify.pool);
      const rt = await loadLlmRuntime(fastify.pool);
      const endpoint = resolveLlmEndpoint(qualifiedModel, rt);
      const noThink = endpoint.isLmStudio && (await resolveQwenNoThink(fastify.pool));

      // user-сообщение
      const userRow = (
        await fastify.pool.query(
          `INSERT INTO ai_chat_messages (chat_id, role, status, content) VALUES ($1, 'user', 'done', $2) RETURNING *`,
          [chat.id, body.content],
        )
      ).rows[0];

      // Авто-заголовок из первого сообщения.
      await fastify.pool.query(
        `UPDATE ai_chats SET title = COALESCE(title, left($2, 80)), updated_at = now() WHERE id = $1`,
        [chat.id, body.content],
      );

      if (!endpoint.enabled) {
        // Деградация без настроенного провайдера: детерминированный поиск-карточки, без диалога.
        const hasTrgm = await hasPgTrgm(fastify.pool);
        const ctx: AgentContext = {
          db: fastify.pool, estimateId: chat.estimateId, projectId: chat.projectId,
          chatId: chat.id, user: chatUser(request.currentUser), catalogMode: CHAT_CATALOG_MODE,
          sectionScope: body.sectionScope, hasTrgm,
        };
        const items = await searchCatalogWorks(ctx, { query: body.content, limit: 8 });
        const cards: ChatCard[] = items.length ? [{ type: 'work_candidates', title: body.content, items }] : [];
        const reason = endpoint.isLmStudio
          ? 'не настроен сервер моделей LM Studio'
          : 'не настроен ключ OpenRouter';
        const content =
          `ИИ-диалог недоступен (${reason}). ` +
          (items.length ? 'Вот что нашлось в справочнике по вашему запросу:' : 'Ничего подходящего в справочнике не нашлось.');
        const asstRow = (
          await fastify.pool.query(
            `INSERT INTO ai_chat_messages (chat_id, role, status, content, model, steps, cards)
             VALUES ($1, 'assistant', 'done', $2, $3, '[]'::jsonb, $4::jsonb) RETURNING *`,
            [chat.id, content, endpoint.model, JSON.stringify(cards)],
          )
        ).rows[0];
        return reply.status(201).send({ data: { user: mapMessage(userRow), assistant: mapMessage(asstRow) } });
      }

      // assistant-сообщение в статусе running + фоновый ход агента
      const asstRow = (
        await fastify.pool.query(
          `INSERT INTO ai_chat_messages (chat_id, role, status, model, steps, cards)
           VALUES ($1, 'assistant', 'running', $2, '[]'::jsonb, '[]'::jsonb) RETURNING *`,
          [chat.id, endpoint.model],
        )
      ).rows[0];

      void runChatTurn(fastify, {
        assistantId: asstRow.id,
        userMsgId: userRow.id,
        chatId: chat.id,
        estimateId: chat.estimateId,
        projectId: chat.projectId,
        user: chatUser(request.currentUser),
        userText: body.content,
        endpoint,
        noThink,
        sectionScope: body.sectionScope,
      });

      return reply.status(201).send({ data: { user: mapMessage(userRow), assistant: mapMessage(asstRow) } });
    },
  );

  // POST /api/ai-chat/messages/:id/cancel — остановить ход агента
  fastify.post<{ Params: { id: string } }>(
    '/messages/:id/cancel',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const upd = await fastify.pool.query(
        `UPDATE ai_chat_messages SET status = 'cancelled' WHERE id = $1 AND status = 'running' RETURNING id`,
        [request.params.id],
      );
      runningChats.get(request.params.id)?.abort();
      if (upd.rowCount === 0) return reply.status(409).send({ error: 'Сообщение уже завершено' });
      return { data: { id: request.params.id, status: 'cancelled' } };
    },
  );

  // POST /api/ai-chat/apply — добавить выбранные позиции (canonical из БД)
  fastify.post('/apply', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    // apply — ручное действие пользователя, работает и без ключа OpenRouter.
    const body = aiChatApplySchema.parse(request.body);
    const chat = await loadChat(body.chatId);
    if (!chat) return reply.status(404).send({ error: 'Чат не найден' });
    try {
      await assertEstimateAccess(fastify.pool, chat.estimateId, chatUser(request.currentUser));
    } catch (err) {
      if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }

    const model = await resolveChatModel(fastify.pool);
    const correlationId = randomUUID();
    const applyCtx: ApplyContext = {
      estimateId: chat.estimateId,
      projectId: chat.projectId,
      chatId: chat.id,
      userId: request.currentUser.id,
      model,
      prompt: 'Добавлено из ИИ-чата',
      correlationId,
    };

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await applySelected(client, applyCtx, body.items, body.override);
      await client.query('COMMIT');
      await fastify.publishEstimateChanged(
        makeEstimateEvent({ estimateId: chat.estimateId, projectId: chat.projectId, reason: 'ai_applied', actorUserId: request.currentUser.id, correlationId }),
      );
      return { data: { added: res.added, addedItemIds: res.addedItemIds, skipped: res.skipped } };
    } catch (err) {
      await client.query('ROLLBACK');
      fastify.log.error({ err }, 'ai chat apply failed');
      return reply.status(500).send({ error: 'Не удалось добавить позиции' });
    } finally {
      client.release();
    }
  });

  // POST /api/ai-chat/apply-section — копировать раздел из другой сметы
  fastify.post('/apply-section', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = applySectionSchema.parse(request.body);
    const chat = await loadChat(body.chatId);
    if (!chat) return reply.status(404).send({ error: 'Чат не найден' });
    const user = chatUser(request.currentUser);
    try {
      await assertEstimateAccess(fastify.pool, chat.estimateId, user);
      await assertEstimateAccess(fastify.pool, body.sourceEstimateId, user); // доступ к источнику
    } catch (err) {
      if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }

    const model = await resolveChatModel(fastify.pool);
    const correlationId = randomUUID();
    const applyCtx: ApplyContext = {
      estimateId: chat.estimateId, projectId: chat.projectId, chatId: chat.id, userId: request.currentUser.id, model,
      prompt: 'Копирование раздела из ИИ-чата', correlationId,
    };
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await applySection(client, applyCtx, body.sourceEstimateId, body.costTypeId, body.override);
      await client.query('COMMIT');
      await fastify.publishEstimateChanged(
        makeEstimateEvent({ estimateId: chat.estimateId, projectId: chat.projectId, reason: 'ai_applied', actorUserId: request.currentUser.id, correlationId }),
      );
      return { data: { added: res.added, addedItemIds: res.addedItemIds, skipped: res.skipped } };
    } catch (err) {
      await client.query('ROLLBACK');
      fastify.log.error({ err }, 'ai chat apply-section failed');
      return reply.status(500).send({ error: 'Не удалось скопировать раздел' });
    } finally {
      client.release();
    }
  });

  // DELETE /api/ai-chat/sessions/:id — архивировать сессию
  fastify.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const chat = await loadChat(request.params.id);
      if (!chat) return reply.status(404).send({ error: 'Чат не найден' });
      try {
        await assertEstimateAccess(fastify.pool, chat.estimateId, chatUser(request.currentUser));
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      await fastify.pool.query(`UPDATE ai_chats SET status = 'archived' WHERE id = $1`, [request.params.id]);
      return { success: true };
    },
  );
}
