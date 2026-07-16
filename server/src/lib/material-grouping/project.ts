/**
 * Проекция общего результата группировки на область подрядчика.
 *
 * Результат считается по всей смете и одинаков для всех — но отдавать его подрядчику целиком
 * нельзя: orderKey содержит НАЗВАНИЕ материала, а вместе с именами групп и замечаниями это весь
 * состав сметы, включая работы других подрядчиков. Фильтрации на клиенте недостаточно: данные
 * уже ушли бы в ответ API.
 *
 * Обрезаем здесь, на сервере. Функция чистая — вся логика видимости проверяется тестами.
 */
import type { GroupingResult, MaterialGroupDto } from '@estimat/shared';

/**
 * Оставить только строки из visibleKeys.
 *   • группы без единой видимой строки удаляются целиком;
 *   • issues без видимых строк отбрасываются (иначе в тексте утекут чужие материалы);
 *   • missing показываем, только если группа видна целиком: при частичной видимости совет
 *     «не хватает X» вводит в заблуждение — X заказывает другой подрядчик;
 *   • stats пересчитывается по видимому, иначе сводка не сойдётся со строками на экране.
 */
export function projectResultFor(result: GroupingResult, visibleKeys: ReadonlySet<string>): GroupingResult {
  const groups: MaterialGroupDto[] = [];
  for (const g of result.groups) {
    const orderKeys = g.orderKeys.filter((k) => visibleKeys.has(k));
    if (orderKeys.length === 0) continue;
    const partial = orderKeys.length < g.orderKeys.length;
    groups.push({
      ...g,
      orderKeys,
      // Замечание без привязки к строкам относится к группе целиком — оно остаётся.
      issues: g.issues
        .filter((i) => i.orderKeys.length === 0 || i.orderKeys.some((k) => visibleKeys.has(k)))
        .map((i) => ({ ...i, orderKeys: i.orderKeys.filter((k) => visibleKeys.has(k)) })),
      missing: partial ? [] : g.missing,
    });
  }

  const sharedKeys = result.sharedKeys.filter((k) => visibleKeys.has(k));
  const ungroupedKeys = result.ungroupedKeys.filter((k) => visibleKeys.has(k));
  const covered = groups.reduce((s, g) => s + g.orderKeys.length, 0);

  return {
    groups,
    sharedKeys,
    ungroupedKeys,
    stats: {
      // batches — характеристика прогона, а не выборки: оставляем как есть.
      batches: result.stats.batches,
      groups: groups.length,
      covered,
      shared: sharedKeys.length,
      ungrouped: ungroupedKeys.length,
      total: covered + sharedKeys.length + ungroupedKeys.length,
    },
  };
}
