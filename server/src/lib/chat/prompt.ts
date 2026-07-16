/**
 * Системные промпты ИИ-ассистента сметчика (режим чата).
 *
 * Тексты по умолчанию теперь живут в общем владельце lib/llm/prompts.ts (редактируются в
 * администрировании). Здесь — совместимые реэкспорты дефолтов: фактические тексты в рантайме
 * резолвятся из БД в routes/ai-chat (resolvePrompt), эти константы служат fallback-дефолтом.
 */
import { PROMPT_DEFAULTS } from '../llm/prompts.js';

export const CHAT_SYSTEM_PROMPT = PROMPT_DEFAULTS['chat.system'];

export const CHAT_SCOPE_NOTE = PROMPT_DEFAULTS['chat.scopeNote'];
