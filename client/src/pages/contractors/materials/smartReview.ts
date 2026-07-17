// Признак «группа требует проверки» — общий для панели и тулбара.
//
// Счётчик на переключателе «Только с замечаниями» и сам отбор обязаны считать одно и то же:
// разойдись они — переключатель обещал бы N групп и показывал другое число.
import type { MaterialGroupDto } from '@estimat/shared';
import type { DimensionFinding } from './dimensionChecks';

/**
 * Требует проверки — это и модельные оси, и детерминированные замечания: без последнего условия
 * отбор спрятал бы карточку, в которой найдено дробное количество штучного материала.
 */
export function isReviewGroup(g: MaterialGroupDto, dimension: Map<string, DimensionFinding>): boolean {
  return (
    g.completeness !== 'complete' ||
    g.compatibility !== 'no_issues' ||
    g.orderKeys.some((k) => dimension.has(k))
  );
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
