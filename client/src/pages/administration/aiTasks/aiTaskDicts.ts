/** Словари и форматтеры вкладки «Задания ИИ». */
import type { AiTaskItem, AiTaskKind } from '@estimat/shared';

export const TASK_KIND: Record<AiTaskKind, { label: string; full: string; color: string }> = {
  md: { label: 'Обработка MD', full: 'Обработка MD', color: 'blue' },
  chat: { label: 'Чат', full: 'Чат', color: 'purple' },
  grouping: { label: 'Группировка', full: 'Умная группировка', color: 'gold' },
};

/** Приведённый статус задачи. partial — только у чат-сессии со смешанным исходом ходов. */
export const TASK_STATUS: Record<string, { label: string; color: string }> = {
  queued: { label: 'В очереди', color: 'default' },
  running: { label: 'Обработка', color: 'processing' },
  succeeded: { label: 'Готово', color: 'green' },
  partial: { label: 'Частично', color: 'orange' },
  failed: { label: 'Ошибка', color: 'red' },
  cancelled: { label: 'Остановлено', color: 'orange' },
  dead: { label: 'Зависло', color: 'volcano' },
};

/** Стадия одного вызова модели (журнал 0064/0065). */
export const CALL_STATUS: Record<string, { label: string; color: string }> = {
  queued: { label: 'В очереди', color: 'default' },
  waiting_slot: { label: 'Ожидание слота', color: 'default' },
  in_progress: { label: 'Отправлен запрос', color: 'processing' },
  succeeded: { label: 'Успешно', color: 'green' },
  failed: { label: 'Ошибка', color: 'red' },
  timed_out: { label: 'Таймаут', color: 'red' },
  cancelled: { label: 'Остановлен', color: 'orange' },
  empty: { label: 'Пустой ответ', color: 'red' },
};

export const PARSE_STATUS: Record<string, string> = {
  not_run: 'не выполнялся',
  ok: 'без замечаний',
  warnings: 'с замечаниями',
  failed: 'не разобран',
};

/** Этап конвейера. Незнакомое значение показывается как есть — список этапов растёт. */
export const CALL_KIND: Record<string, string> = {
  batch: 'Набор',
  merge: 'Слияние',
  'extract.items': 'Извлечение позиций',
  'extract.match': 'Сопоставление',
  'extract.suggest_works': 'Подбор работ',
  'extract.assign_materials': 'Распределение материалов',
  'extract.sweep_works': 'Дообход работ',
  'extract.sweep_material_to_work': 'Дообход материалов',
  'chat.agent': 'Ход агента',
  'chat.force_final': 'Добор ответа',
};

export const isActive = (s: string): boolean => s === 'queued' || s === 'running';

/** Ключ строки: id из трёх разных таблиц могут совпасть. */
export const taskKey = (t: AiTaskItem): string => `${t.kind}:${t.id}`;

export const fmtInt = (n: number | null | undefined): string =>
  typeof n === 'number' ? n.toLocaleString('ru-RU') : '—';

/** «12 с» / «3:24» / «1:05:12». */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}:${String(rs).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(rs).padStart(2, '0')}`;
}

/** Без секунд: в списке они не нужны, а место занимают. Полная дата — в подсказке. */
export const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export const fmtDateTimeFull = (v: string): string => new Date(v).toLocaleString('ru-RU');

/** Модель без префикса провайдера — для узкой колонки. */
export const shortModel = (m: string): string => {
  const i = m.indexOf(':');
  return i > 0 ? m.slice(i + 1) : m;
};

/** «Иванов +2» — авторов у чат-сессии может быть несколько. */
export function fmtUsers(users: string[], kind: AiTaskKind): string {
  // Пусто у автоматической группировки: она идёт сама при правке сметы, инициатора нет.
  if (!users.length) return kind === 'grouping' ? 'Система' : '—';
  return users.length === 1 ? users[0]! : `${users[0]} +${users.length - 1}`;
}

/** Сумма токенов; null — если расход неизвестен (провайдер не вернул usage либо журнала не было). */
export function totalTokens(t: AiTaskItem): number | null {
  if (t.promptTokens == null && t.completionTokens == null) return null;
  return (t.promptTokens ?? 0) + (t.completionTokens ?? 0);
}

/** Текст → строка для <pre>. Устойчив к тому, что в поле может лежать JSON или объект. */
export function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}

/**
 * Сообщения запроса, если в тексте лежит JSON-массив ролей (так пишет чат).
 * У группировки и извлечения запрос — обычный текст, и разбирать его не нужно.
 */
export interface LlmMessage {
  role?: string;
  content?: unknown;
  name?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string | null;
}

export function parseMessages(text: string | null): LlmMessage[] | null {
  if (!text || !text.trimStart().startsWith('[')) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (Array.isArray(v) && v.every((m) => m && typeof m === 'object' && 'role' in m)) {
      return v as LlmMessage[];
    }
  } catch {
    /* не JSON — покажем как текст */
  }
  return null;
}
