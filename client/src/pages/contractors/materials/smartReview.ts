// Состояние проверки группы — общий расчёт для карточки, панели и тулбара.
//
// Бейдж в шапке блока, панель «Результат проверки», отбор «Только с замечаниями» и счётчик на нём
// обязаны считать одно и то же. Разойдись они — переключатель обещал бы одно число групп, а экран
// показывал другое, и блок с бейджем «Проверить · 1» исчезал бы при включении отбора (так и было,
// пока отбор смотрел только на оси модели, а бейдж — ещё и на замечания).
import type { MaterialGroupDto } from '@estimat/shared';
import type { DimensionFinding } from './dimensionChecks';

/** Цвет бейджа — максимальный риск блока: красный → оранжевый → золотой. */
export type CheckColor = 'red' | 'orange' | 'gold';

export interface GroupCheck {
  /** Конкретных замечаний к прочтению: размерность + замечания ИИ + возможные пропуски. */
  details: number;
  /** Число на бейдже: details, а без конкретики — 1 (неблагополучная ось сама по себе повод). */
  count: number;
  color: CheckColor;
  /** Неблагополучные оси модели — резюме в панели. Пусто, если обе оси в порядке. */
  axes: string[];
  /** Находки размерности по переданным строкам блока. */
  dimension: DimensionFinding[];
}

/**
 * Что в блоке требует проверки. `null` — блок в порядке: ни бейджа, ни панели, ни попадания в отбор.
 *
 * Оси комплектности и совместимости независимы, поэтому в `axes` попадают обе сразу: свести их к
 * одной «главной» подписи — значит потерять вторую.
 *
 * @param keys ключи заказа строк, по которым считать размерность. По умолчанию — весь состав
 *   группы (отбор и счётчик), карточка передаёт только видимые строки: у подрядчика группа обрезана.
 */
export function groupCheck(
  g: MaterialGroupDto,
  dimension: Map<string, DimensionFinding>,
  keys: string[] = g.orderKeys,
): GroupCheck | null {
  const dim = keys.map((k) => dimension.get(k)).filter((f): f is DimensionFinding => !!f);

  const axes: string[] = [];
  if (g.compatibility === 'possible_issue') axes.push('Возможные несовместимости');
  if (g.completeness === 'incomplete') axes.push('Неполный комплект');
  // Модель не смогла сделать вывод — честный ответ, а не ошибка. Но и не «всё в порядке».
  if (g.completeness === 'unknown' || g.compatibility === 'unknown') axes.push('ИИ не смог сделать вывод');

  const details = dim.length + g.issues.length + g.missing.length;
  if (details === 0 && axes.length === 0) return null;

  // Оранжевый заслуживает не только неполный комплект: дробное количество штучного материала —
  // факт из сметы, а warning и обязательный пропуск модель называет сама.
  const serious =
    g.completeness === 'incomplete' ||
    dim.length > 0 ||
    g.issues.some((i) => i.severity === 'warning') ||
    g.missing.some((m) => m.need === 'required');
  const color: CheckColor = g.compatibility === 'possible_issue' ? 'red' : serious ? 'orange' : 'gold';

  return { details, count: details || 1, color, axes, dimension: dim };
}

/** Требует проверки — по тому же расчёту, что рисует бейдж в шапке блока. */
export function isReviewGroup(g: MaterialGroupDto, dimension: Map<string, DimensionFinding>): boolean {
  return groupCheck(g, dimension) !== null;
}

/**
 * Сколько видимых групп требуют проверки. Группы целиком из чужих строк не в счёт: у подрядчика
 * в общем результате они есть, но на экране их нет — счётчик обещал бы недостижимое.
 *
 * @param rowKeys ключи заказа строк, которые видит смотрящий
 */
export function countReviewGroups(
  groups: MaterialGroupDto[],
  rowKeys: Set<string>,
  dimension: Map<string, DimensionFinding>,
): number {
  return groups.filter((g) => g.orderKeys.some((k) => rowKeys.has(k)) && isReviewGroup(g, dimension)).length;
}
