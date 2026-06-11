import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { updateAppSettingsSchema, type AppSettings } from '@estimat/shared';

// Соответствие полей API ключам в app_settings.
const SETTING_KEYS: Record<keyof AppSettings, string> = {
  rdSectionEnabled: 'rd_section_enabled',
};

const DEFAULTS: AppSettings = {
  rdSectionEnabled: true,
};

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  async function loadSettings(): Promise<AppSettings> {
    const { rows } = await fastify.pool.query('SELECT key, value FROM app_settings');
    const byKey = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
    const settings = { ...DEFAULTS };
    const rd = byKey.get(SETTING_KEYS.rdSectionEnabled);
    if (typeof rd === 'boolean') settings.rdSectionEnabled = rd;
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
