/**
 * Редактирование текстов LLM-промптов (вкладка «Нейросети» → «Промпты» в администрировании).
 *
 * Только для admin: тексты промптов — внутренняя настройка, их не должен грузить обычный
 * пользователь (поэтому это отдельный роутер, а не часть общего GET /settings). Хранилище —
 * app_settings.ai_prompts (jsonb Record<promptId, string>), запись одного ключа атомарной
 * jsonb-операцией, чтобы параллельная правка не затёрла соседние переопределения.
 */
import type { FastifyInstance } from 'fastify';
import { AI_PROMPT_DEFS, aiPromptIdSchema, updateAiPromptSchema, type AiPromptItem } from '@estimat/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { PROMPT_DEFAULTS, resolveAllPrompts } from '../../lib/llm/prompts.js';

function itemsOf(effective: Record<string, string>): AiPromptItem[] {
  return AI_PROMPT_DEFS.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    group: d.group,
    value: effective[d.id]!,
    defaultValue: PROMPT_DEFAULTS[d.id],
    overridden: effective[d.id] !== PROMPT_DEFAULTS[d.id],
  }));
}

export default async function aiPromptsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('admin'));

  // GET / — все промпты с действующим текстом, дефолтом и признаком переопределения.
  fastify.get('/', async () => {
    return { data: itemsOf(await resolveAllPrompts(fastify.pool)) };
  });

  // PATCH /:id — задать переопределение (value: string) или сбросить к дефолту (value: null).
  fastify.patch('/:id', async (request, reply) => {
    const idParse = aiPromptIdSchema.safeParse((request.params as { id?: string }).id);
    if (!idParse.success) return reply.status(400).send({ error: 'Неизвестный промпт' });
    const id = idParse.data;
    const body = updateAiPromptSchema.parse(request.body);

    if (body.value === null) {
      // Сброс: удалить ключ. Строки ai_prompts может ещё не быть — тогда удалять нечего.
      await fastify.pool.query(
        `UPDATE app_settings SET value = value - $1, updated_at = now() WHERE key = 'ai_prompts'`,
        [id],
      );
    } else {
      // Атомарная запись одного ключа: не заменяем весь объект, чтобы не потерять соседние правки.
      await fastify.pool.query(
        `INSERT INTO app_settings (key, value)
         VALUES ('ai_prompts', jsonb_build_object($1::text, $2::text))
         ON CONFLICT (key) DO UPDATE
           SET value = jsonb_set(COALESCE(app_settings.value, '{}'::jsonb), ARRAY[$1::text], to_jsonb($2::text)),
               updated_at = now()`,
        [id, body.value],
      );
    }

    const items = itemsOf(await resolveAllPrompts(fastify.pool));
    return { data: items.find((i) => i.id === id)! };
  });
}
