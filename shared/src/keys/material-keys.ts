/**
 * Ключи свёртки и заказа материалов — единственный источник истины для клиента и сервера.
 *
 * На них держится учёт заявок: «Заказано» = SUM(quantity) по (cost_type_id, agg_key), а строки
 * заявки принимаются, только если их ключ совпал с пересобранным из БД (visibleMaterialKeys).
 * Поэтому формат нельзя менять без миграции material_request_items.agg_key — образец такой
 * миграции: 0039_relink_material_requests_catalog.sql.
 */

/**
 * Ключ свёртки материала: справочный — по material_id + ед., текстовый — по нормализованному
 * названию + ед. Разные единицы не суммируем — дадут две строки.
 */
export function aggKey(materialId: string | null, name: string, unit: string): string {
  const u = (unit ?? '').trim().toLowerCase();
  return materialId ? `id:${materialId}|${u}` : `txt:${name.trim().toLowerCase()}|${u}`;
}

/** Ключ строки заказа/заявки: (вид работ, свёртка материала). */
export const lineKey = (costTypeId: string | null, key: string): string => `${costTypeId ?? ''}|${key}`;
