import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { updateAppSettingsSchema, aiCatalogSourceSchema, type AppSettings } from '@estimat/shared';

// Соответствие полей API ключам в app_settings.
const SETTING_KEYS: Record<keyof AppSettings, string> = {
  rdSectionEnabled: 'rd_section_enabled',
  aiCatalogSource: 'ai_catalog_source',
  aiModels: 'ai_models',
  aiModelDefault: 'ai_model_default',
  aiChatModelDefault: 'ai_chat_model_default',
};

const DEFAULTS: AppSettings = {
  rdSectionEnabled: true,
  aiCatalogSource: 'v2_first',
  aiModels: ['google/gemini-2.5-flash'],
  aiModelDefault: 'google/gemini-2.5-flash',
  aiChatModelDefault: 'google/gemini-2.5-flash',
};

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  async function loadSettings(): Promise<AppSettings> {
    const { rows } = await fastify.pool.query('SELECT key, value FROM app_settings');
    const byKey = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
    const settings = { ...DEFAULTS };
    const rd = byKey.get(SETTING_KEYS.rdSectionEnabled);
    if (typeof rd === 'boolean') settings.rdSectionEnabled = rd;
    const cat = aiCatalogSourceSchema.safeParse(byKey.get(SETTING_KEYS.aiCatalogSource));
    if (cat.success) settings.aiCatalogSource = cat.data;
    const models = byKey.get(SETTING_KEYS.aiModels);
    if (Array.isArray(models) && models.every((m) => typeof m === 'string')) {
      settings.aiModels = models as string[];
    }
    const def = byKey.get(SETTING_KEYS.aiModelDefault);
    if (typeof def === 'string' && def) settings.aiModelDefault = def;
    const chatDef = byKey.get(SETTING_KEYS.aiChatModelDefault);
    if (typeof chatDef === 'string' && chatDef) settings.aiChatModelDefault = chatDef;
    return settings;
  }

  // GET /api/settings — доступно всем авторизованным (нужно для отображения UI)
  fastify.get('/', async () => {
    return { data: await loadSettings() };
  });

  // PUT /api/settings — только admin
  fastify.put('/', { preHandler: [requireRole('admin')] }, async (request) => {
    const body = updateAppSettingsSchema.parse(request.body);
    for (const [field, key] of Object.entries(SETTING_KEYS) as [keyof AppSettings, string][]) {
      const value = body[field];
      if (value === undefined) continue;
      await fastify.pool.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    }
    return { data: await loadSettings() };
  });
}
