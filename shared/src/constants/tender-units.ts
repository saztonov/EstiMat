// Сопоставление свободной единицы измерения EstiMat с ФИКСИРОВАННЫМ перечнем единиц тендерного
// портала zakupki (enum UNITS). Портал принимает только эти коды; неизвестную единицу отправлять
// НЕЛЬЗЯ (меняется коммерческий смысл позиции) — mapTenderUnit возвращает null, вызывающий блокирует
// выгрузку до сопоставления. Совпадает с UNIT_LABELS портала.

export const TENDER_UNIT_CODES = ['pcs', 'm', 'm2', 'm3', 'kg', 't', 'l', 'set', 'h'] as const;
export type TenderUnitCode = (typeof TENDER_UNIT_CODES)[number];

export const TENDER_UNIT_LABELS: Record<TenderUnitCode, string> = {
  pcs: 'шт.',
  m: 'м',
  m2: 'м²',
  m3: 'м³',
  kg: 'кг',
  t: 'т',
  l: 'л',
  set: 'компл.',
  h: 'ч',
};

// Нормализованные варианты записи (RU/латиница) → код портала. Ключи уже приведены normalizeUnit().
const TENDER_UNIT_SYNONYMS: Record<string, TenderUnitCode> = {
  // штуки
  pcs: 'pcs', 'шт': 'pcs', 'штука': 'pcs', 'штук': 'pcs', 'штуки': 'pcs', 'ед': 'pcs',
  // погонный / линейный метр
  m: 'm', 'м': 'm', 'метр': 'm', 'пм': 'm', 'погм': 'm', 'погонныйметр': 'm', 'мп': 'm',
  // площадь
  m2: 'm2', 'м2': 'm2', 'квм': 'm2', 'кв м': 'm2', 'квадратныйметр': 'm2',
  // объём
  m3: 'm3', 'м3': 'm3', 'кубм': 'm3', 'куб м': 'm3', 'кубическийметр': 'm3',
  // масса
  kg: 'kg', 'кг': 'kg', 'килограмм': 'kg',
  t: 't', 'т': 't', 'тн': 't', 'тонна': 't',
  // объём (жидкость)
  l: 'l', 'л': 'l', 'литр': 'l',
  // комплект
  set: 'set', 'компл': 'set', 'комплект': 'set', 'набор': 'set', 'к-т': 'set', 'кт': 'set',
  // время
  h: 'h', 'ч': 'h', 'час': 'h', 'часов': 'h',
};

// Приведение единицы к каноническому ключу: нижний регистр, ² → 2, ³ → 3, «кв.м»→«квм», «куб.м»→«кубм»,
// удаление точек/пробелов по краям и служебных символов, схлопывание пробелов.
function normalizeUnit(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/кв\.?\s*м/g, 'квм')
    .replace(/куб\.?\s*м/g, 'кубм')
    .replace(/пог\.?\s*м/g, 'погм')
    .replace(/[.\s]+$/g, '')
    .replace(/^[.\s]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]/g, '');
}

/** Код единицы портала или null, если единица не сопоставлена (выгрузку следует заблокировать). */
export function mapTenderUnit(raw: string | null | undefined): TenderUnitCode | null {
  if (!raw) return null;
  return TENDER_UNIT_SYNONYMS[normalizeUnit(raw)] ?? null;
}
