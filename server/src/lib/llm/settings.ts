/**
 * Настройки выбора модели из app_settings. Общие резолверы: до этого они были копипастой
 * в routes/ai и routes/ai-chat, и каждый новый сценарий добавлял ещё одну копию.
 */
import type { Pool } from 'pg';
import { config } from '../../config.js';

/**
 * Первая непустая строковая настройка из перечисленных ключей, иначе fallback.
 * Порядок ключей = приоритет (например: модель чата → модель РД → env).
 */
export async function resolveModelSetting(pool: Pool, keys: string[], fallback: string): Promise<string> {
  const r = await pool.query(`SELECT key, value FROM app_settings WHERE key = ANY($1)`, [keys]);
  const byKey = new Map<string, unknown>(r.rows.map((x) => [x.key, x.value]));
  for (const k of keys) {
    const v = byKey.get(k);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return fallback;
}

/** Модель извлечения РД: ai_model_default → env. */
export const resolveAiModel = (pool: Pool): Promise<string> =>
  resolveModelSetting(pool, ['ai_model_default'], config.ai.model);

/** Модель ИИ-чата: ai_chat_model_default → ai_model_default → env. */
export const resolveChatModel = (pool: Pool): Promise<string> =>
  resolveModelSetting(pool, ['ai_chat_model_default', 'ai_model_default'], config.ai.model);

/** Режим Qwen без рассуждений (ai_qwen_no_think, по умолчанию включён). */
export async function resolveQwenNoThink(pool: Pool): Promise<boolean> {
  const r = await pool.query(`SELECT value FROM app_settings WHERE key = 'ai_qwen_no_think'`);
  const v = r.rows[0]?.value;
  return typeof v === 'boolean' ? v : true;
}
