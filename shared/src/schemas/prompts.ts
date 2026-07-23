import { z } from 'zod';

/**
 * Реестр редактируемых LLM-промптов (вкладка «Нейросети» → «Промпты» в администрировании).
 *
 * Здесь только МЕТАДАННЫЕ (id, заголовок, описание, группа) — тексты по умолчанию живут на
 * сервере (server/src/lib/llm/prompts.ts), чтобы не дублировать длинные строки в бандл клиента
 * и держать владельца дефолтов в одном месте. Переопределения хранятся в app_settings.ai_prompts.
 */

export const AI_PROMPT_IDS = [
  'grouping.system',
  'grouping.merge',
  'chat.system',
  'chat.scopeNote',
  'extract.role',
  'invoice.extract',
] as const;
export type AiPromptId = (typeof AI_PROMPT_IDS)[number];

export const aiPromptIdSchema = z.enum(AI_PROMPT_IDS);

/** Группы для раскладки в UI. */
export const AI_PROMPT_GROUPS = {
  grouping: 'Умная группировка материалов',
  chat: 'ИИ-чат',
  extract: 'Извлечение из рабочей документации',
  invoice: 'Распознавание счетов',
} as const;
export type AiPromptGroup = keyof typeof AI_PROMPT_GROUPS;

export interface AiPromptDef {
  id: AiPromptId;
  title: string;
  description: string;
  group: AiPromptGroup;
}

/** Максимальная длина текста промпта (защита от случайной вставки мусора). */
export const AI_PROMPT_MAX_LENGTH = 20_000;

export const AI_PROMPT_DEFS: readonly AiPromptDef[] = [
  {
    id: 'grouping.system',
    title: 'Системный промпт группировки',
    description:
      'Основные правила разбора материалов на комплекты заявки: что объединяется в один блок, что разделяется, служебный ярлык стадии готовности и проверка комплектности.',
    group: 'grouping',
  },
  {
    id: 'grouping.merge',
    title: 'Промпт слияния групп',
    description:
      'Второй проход: объединение черновых блоков одного комплекта, разъехавшихся по наборам — в том числе по разным видам работ.',
    group: 'grouping',
  },
  {
    id: 'chat.system',
    title: 'Системный промпт ИИ-чата',
    description: 'Роль и правила ассистента-сметчика в режиме чата.',
    group: 'chat',
  },
  {
    id: 'chat.scopeNote',
    title: 'ИИ-чат: примечание об области подбора',
    description: 'Добавляется к системному промпту, когда активна область подбора (раздел/вид затрат).',
    group: 'chat',
  },
  {
    id: 'extract.role',
    title: 'Извлечение из РД: роль/префикс',
    description:
      'Общий префикс роли сметчика для извлечения работ и материалов из документации. Это только начало промпта — конкретные инструкции по типу документа задаются в коде.',
    group: 'extract',
  },
  {
    id: 'invoice.extract',
    title: 'Распознавание счёта: системный промпт',
    description:
      'Правила чтения счёта поставщика: какие реквизиты извлекать, как переносить числа и НДС, чего не домысливать. Формат ответа (JSON-схема) задаётся в коде и промптом не меняется.',
    group: 'invoice',
  },
];

/** Элемент ответа GET /settings/ai-prompts. */
export interface AiPromptItem {
  id: AiPromptId;
  title: string;
  description: string;
  group: AiPromptGroup;
  /** Действующий текст (переопределение либо дефолт). */
  value: string;
  /** Текст по умолчанию (для показа и сброса). */
  defaultValue: string;
  /** true — задано переопределение, отличное от дефолта. */
  overridden: boolean;
}

export interface AiPromptsResponse {
  data: AiPromptItem[];
}

/** Тело PATCH /settings/ai-prompts/:id. value: null — сброс к дефолту. */
export const updateAiPromptSchema = z.object({
  value: z.string().min(1).max(AI_PROMPT_MAX_LENGTH).nullable(),
});
export type UpdateAiPromptInput = z.infer<typeof updateAiPromptSchema>;
