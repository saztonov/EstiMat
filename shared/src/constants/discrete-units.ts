// Неделимые (штучные) единицы измерения и проверка дробных количеств.
//
// Диагностика для сметчика: «оборудование не может быть 0,5 шт». Полкомплекта, полсистемы и
// полкронштейна не купить — дробь в такой единице почти всегда ошибка сметчика или деления объёма.
//
// НАМЕРЕННО отдельно от tender-units.ts: там карта единиц портала zakupki — контракт выгрузки, и
// правка ради диагностики молча изменила бы коммерческий смысл позиций (единица, которая сейчас
// блокирует выгрузку, начала бы маппиться в pcs). Нормализация здесь своя и проще: политики разные,
// механика совпадает лишь внешне.
//
// Список закрытый: сюда попадают только единицы, где дробь НЕ может быть законной. Незнакомая
// единица — молчим (тот же принцип, что «Не уверен — ставь unknown» в промптах).

/** Ключи уже нормализованы normalizeDiscreteUnit(). */
const DISCRETE_UNITS: ReadonlySet<string> = new Set([
  // штуки
  'шт', 'штука', 'штук', 'штуки', 'ед', 'единица',
  // комплекты и наборы
  'компл', 'комплект', 'к-т', 'кт', 'ком-т', 'набор', 'пара',
  // счётные единицы проектов (так они и названы в справочнике)
  'узел', 'система', 'точка', '1 точка', 'этаж/лифт',
]);

/** Допуск на плавающую точку: 200.00000001 шт — это 200 шт, а не дробь. */
const EPS = 1e-6;

/** Та же точность, что у «Кол-во по смете»: свод суммирует вхождения, хвосты гасим здесь. */
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Регистр, лишние пробелы и точки: «Шт.» и «шт» — одна единица. */
function normalizeDiscreteUnit(raw: string): string {
  return raw.toLowerCase().trim().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

/** Единица неделимая (штучная)? Неизвестная единица — нет. */
export function isDiscreteUnit(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return DISCRETE_UNITS.has(normalizeDiscreteUnit(raw));
}

export interface DiscreteQtyIssue {
  /** Количество, округлённое до отображаемой точности. */
  quantity: number;
  /** Ближайшее целое вверх: недозаказ останавливает работы, а полболта не купить. */
  suggested: number;
}

/**
 * Дробное количество в неделимой единице. null — единица делимая либо неизвестная, количество
 * целое, нулевое или бессмысленное.
 */
export function checkDiscreteQuantity(
  unit: string | null | undefined,
  quantity: number,
): DiscreteQtyIssue | null {
  if (!isDiscreteUnit(unit)) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const q = round4(quantity);
  if (Math.abs(q - Math.round(q)) <= EPS) return null;
  return { quantity: q, suggested: Math.ceil(q) };
}
