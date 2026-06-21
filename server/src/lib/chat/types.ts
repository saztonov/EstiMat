/** Общие типы агентного ядра ИИ-чата. */
import type { Role } from '@estimat/shared';
import type { CatalogSourceMode, SectionScope } from '../extract/types.js';
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
  /**
   * Область подбора (разделы/виды), выбранная сметчиком в чате. Сужает поиск по
   * справочнику (работы и материалы). Имя `sectionScope`, а не `scope`, чтобы не
   * путать с параметром `scope: 'other_projects'|...` поиска похожих позиций.
   */
  sectionScope?: SectionScope;
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
