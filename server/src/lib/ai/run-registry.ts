/**
 * Реестр выполняющихся прогонов ИИ (AbortController на прогон).
 *
 * Переехал из модулей роутов: административная вкладка «Задания ИИ» останавливает задачи всех
 * контуров одной кнопкой, и её роут обязан дотянуться до контроллера, живущего в чужом модуле.
 * Импортировать роут из роута ради этого — худшая из связностей.
 *
 * Корректно при одном инстансе API (текущий прод — single-VPS). Гонку «отмена vs запуск»
 * закрывает не реестр, а УСЛОВНЫЕ переходы статуса (WHERE status = ...) на стороне вызывающих:
 * пропущенный abort означает лишь, что прогон доработает и увидит отменённый статус в БД.
 *
 * Группировка сюда не переехала: её реестр уже живёт в lib (abortGroupingJob).
 */

/** Вид прогона. Для чата единица — ХОД (сообщение ассистента), а не сессия. */
export type RunKind = 'md_extract' | 'chat_turn';

const runs = new Map<string, AbortController>();

const key = (kind: RunKind, id: string): string => `${kind}:${id}`;

export function registerRun(kind: RunKind, id: string, controller: AbortController): void {
  runs.set(key(kind, id), controller);
}

export function unregisterRun(kind: RunKind, id: string): void {
  runs.delete(key(kind, id));
}

/** Прервать прогон. false — прогона нет в этом процессе (уже завершён либо чужой инстанс). */
export function abortRun(kind: RunKind, id: string): boolean {
  const c = runs.get(key(kind, id));
  if (!c) return false;
  c.abort();
  return true;
}
