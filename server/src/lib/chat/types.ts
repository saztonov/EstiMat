/** Общие типы агентного ядра ИИ-чата. */
import type { Role } from '@estimat/shared';
import type { CatalogSourceMode } from '../extract/types.js';
import type { ChatStep, ChatCard } from '@estimat/shared';

/** Минимальный интерфейс к БД (pg.Pool/Client). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

/** Пользователь чата (подмножество RequestUser). */
export interface ChatUser {
  id: string;
  orgId: string | null;
  role: Role;
}

/** Контекст одного хода агента. */
export interface AgentContext {
  db: Queryable;
  estimateId: string;
  projectId: string;
  chatId: string;
  user: ChatUser;
  /** Источник справочника (настройка ai_catalog_source). */
  catalogMode: CatalogSourceMode;
  /** Доступен ли pg_trgm (иначе поиск деградирует на ILIKE + TS). */
  hasTrgm: boolean;
  signal?: AbortSignal;
}

/** Результат хода агента для записи в ai_chat_messages. */
export interface AgentTurnResult {
  content: string;
  steps: ChatStep[];
  cards: ChatCard[];
}
