// Вид строки/материала для кабинета подрядчика: договорная цена — только своя.
//
// Договорные поля (contract_*) предназначены сотрудникам. Подрядчику показываем ЕГО договорную цену
// (contract_unit_price/contract_total), но лишь когда владелец цены — он сам; чужую и «осиротевшую»
// (владелец не совпал или пуст) обнуляем. На уровне данных цену прежнего исполнителя уже снимает
// clearStaleContractPrices при пересдаче строки — этот фильтр закрывает краевые случаи (несколько
// подрядчиков на строке, рассинхрон). Служебную мету ВОР/аудита не отдаём никогда.
const OWNER_FIELD = 'contract_price_contractor_id';

/** Договорные цены: оставляем владельцу, иначе обнуляем (клиент рисует прочерк по null). */
const PRICE_FIELDS = ['contract_unit_price', 'contract_total'] as const;

/** Служебные поля договорной цены — вырезаем всегда: подрядчику не нужны и раскрывать их не следует. */
const META_FIELDS = [
  'contract_price_vor_id',
  'contract_price_contractor_id',
  'contract_price_updated_at',
  'contract_price_updated_by',
] as const;

export function contractorPriceView<T extends Record<string, unknown>>(row: T, contractorId: string): T {
  const out: Record<string, unknown> = { ...row };
  const owned = out[OWNER_FIELD] != null && out[OWNER_FIELD] === contractorId;
  if (!owned) for (const f of PRICE_FIELDS) out[f] = null;
  for (const f of META_FIELDS) delete out[f];
  return out as T;
}
