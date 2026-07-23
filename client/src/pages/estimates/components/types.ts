import type { LocationEntry } from './location';

// id-заглушка черновой строки (работа/материал в режиме добавления, ещё не сохранена).
export const DRAFT_ID = '__draft__';

export interface Organization {
  id: string;
  name: string;
  type?: string;
}

export interface SaveWorkPayload {
  costTypeId: string | null;
  rateId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  // Локация (опционально): задаётся контекстом добавления или поповером строки.
  // locations — мультизона из поповера; zoneId/floorFrom/floorTo — legacy-контекст добавления.
  locations?: LocationEntry[];
  zoneId?: string | null;
  floorFrom?: number | null;
  floorTo?: number | null;
  roomTypeId?: string | null;
  // Произвольный «тип» строки (на всю работу). Пустая строка/null очищает тип.
  locationTypeName?: string | null;
  // OCC: версия строки на момент открытия формы — сервер сверит и при расхождении вернёт 409.
  expectedVersion?: number | null;
  // Сигнал «поставить строку наверх вида затрат» (добавление из справочника). Сервер вычислит sort_order.
  placeOnTop?: boolean;
}

export interface SaveMaterialPayload {
  materialId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  // Коэффициент расхода: число — кол-во считает сервер (коэф × объём работы); null — ручное кол-во.
  qtyRatio: number | null;
  // OCC: версия материала на момент открытия формы.
  expectedVersion?: number | null;
}

export interface WorkEdit {
  workId: string | null;
  rateId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  // OCC: версия строки на момент открытия формы (обновляется при 409 для повторного сохранения).
  expectedVersion?: number | null;
}

export interface MaterialEdit {
  materialId: string | null;
  refMaterialId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  // Коэффициент расхода: число — кол-во вычисляется (коэф × объём работы), поле кол-ва заблокировано;
  // null — ручной ввод количества.
  qtyRatio: number | null;
  // OCC: версия материала на момент открытия формы.
  expectedVersion?: number | null;
}

export interface EstimateMaterial {
  id: string;
  item_id: string;
  material_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total: string;
  sort_order?: number;
  /** Коэффициент расхода: если задан, кол-во = коэф × объём работы (держится сервером);
   *  null — ручное количество. Числовой, приходит строкой из NUMERIC. */
  qty_ratio?: string | null;
  material_name: string | null;
  /** Договорная цена (из заполненного подрядчиком ВОР) и сумма по ней. null — цены ещё нет:
   *  в разделе «Подрядчики» это прочерк, а не ноль. Базовые unit_price/total не заменяют. */
  contract_unit_price?: string | null;
  contract_total?: string | null;
  /** 'suggested' — добавлен автоматически по типовому набору расценки («предложение»),
   *  требует подтверждения ✓ или удаления ✗; 'confirmed' — подтверждён. */
  status: 'suggested' | 'confirmed';
  /** Источник: 'manual' | 'ai' | 'catalog' (трассировка ИИ-извлечения). */
  source?: 'manual' | 'ai' | 'catalog';
  needs_review?: boolean;
  confidence?: string | number | null;
  // OCC: версия строки, снимается при открытии формы редактирования; растёт при каждом UPDATE.
  version?: number;
}

// Строка сметы = работа. Несёт измерения (объект/категория/вид затрат)
// и список материалов под ней.
export interface EstimateItem {
  id: string;
  estimate_id: string;
  project_id?: string | null;
  cost_category_id: string | null;
  cost_category_name?: string | null;
  cost_category_sort_order?: number | null;
  cost_type_id: string | null;
  cost_type_name?: string | null;
  cost_type_sort_order?: number | null;
  rate_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total: string;
  /** Договорная цена работы (из заполненного подрядчиком ВОР) и сумма по ней; null — цены нет. */
  contract_unit_price?: string | null;
  contract_total?: string | null;
  sort_order: number;
  rate_name: string | null;
  rate_code: string | null;
  materials: EstimateMaterial[];
  /** Источник: 'manual' | 'ai' | 'catalog' (трассировка ИИ-извлечения). */
  source?: 'manual' | 'ai' | 'catalog';
  needs_review?: boolean;
  confidence?: string | number | null;
  // Мультилокация (источник истины): зоны + точный набор этажей.
  locations?: LocationEntry[] | null;
  // Легаси «первичное» зеркало (зона + диапазон этажей) + тип помещения (денормализованные имена).
  zone_id?: string | null;
  zone_name?: string | null;
  zone_kind?: string | null;
  floor_from?: number | null;
  floor_to?: number | null;
  room_type_id?: string | null;
  room_type_name?: string | null;
  // Произвольный «тип» строки (на всю работу), уникальный в рамках объекта.
  location_type_id?: string | null;
  location_type_name?: string | null;
  // Трассировка тиражирования.
  copy_batch_id?: string | null;
  copy_source_item_id?: string | null;
  // Назначения подрядчиков на строку + распределение объёма (раздел «Подрядчики», вид инженера).
  item_contractors?: ItemContractor[];
  assigned_total?: number;
  remaining_qty?: number;
  over_assigned?: boolean;
  /** Подрядчики строки, чьи назначения защищены заявками: по строке уже заказаны материалы,
   *  снять или заменить их нельзя. Авторитет — ответ сервера при назначении; здесь это
   *  разметка интерфейса (замок на чипе) и предпросмотр без второго запроса. */
  request_locked_contractor_ids?: string[];
  // Вид подрядчика (его строки из /contractors/my-items): объём, назначенный его организации.
  my_effective_qty?: string | number | null;
  my_assigned_qty?: string | null;
  my_assigned_percent?: string | null;
  // Тип объёма строки: 'main' (осн) / 'additional' (доп). undefined трактуется как 'main'.
  volume_type?: 'main' | 'additional';
  // OCC: версия строки, снимается при открытии формы редактирования; растёт при каждом UPDATE.
  version?: number;
  // Аудит строки (приходит с сервера: даты + денормализованные имена создателя/редактора).
  created_at?: string;
  updated_at?: string;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  // Кол-во комментариев (примечаний) к работе — для бейджа на иконке-конверте.
  comment_count?: number;
}

// Назначение подрядчика (организации) на строку сметы с распределённым объёмом.
export interface ItemContractor {
  item_id?: string;
  contractor_id: string;
  contractor_name: string | null;
  assigned_qty: string | null;
  assigned_percent: string | null;
  /** Эффективный объём подрядчика по строке (qty, доля или весь объём) — посчитан сервером. */
  effective_qty: string | number;
}

// Подрядчик на вид затрат (estimate + cost_type)
export interface EstimateContractor {
  cost_type_id: string;
  contractor_id: string;
  contractor_name: string | null;
  cost_type_name?: string | null;
  cost_type_sort_order?: number | null;
  cost_category_id?: string | null;
  cost_category_name?: string | null;
  cost_category_sort_order?: number | null;
}

export interface EstimateDetail {
  id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  cost_category_id: string | null;
  cost_category_name: string | null;
  work_type: string | null;
  total_amount: string;
  notes: string | null;
  items: EstimateItem[];
  contractors: EstimateContractor[];
  // Счётчики комментариев по видам работ: { [costTypeId]: number } (с сервера).
  cost_type_comment_counts?: Record<string, number>;
  // Шифры РД по видам работ (в контексте сметы): { [costTypeId]: [{id, code}] } (с сервера).
  cost_type_ciphers?: CostTypeCiphers;
}

/** Шифры РД по видам работ сметы: costTypeId → назначенные шифры. */
export type CostTypeCiphers = Record<string, { id: string; code: string }[]>;

// Группа строк по виду затрат (строится на клиенте из items/contractors)
export interface CostTypeGroup {
  costTypeId: string | null;
  costTypeName: string | null;
  costTypeSortOrder: number | null;
  costCategoryId: string | null;
  costCategoryName: string | null;
  costCategorySortOrder: number | null;
  works: EstimateItem[];
  contractor: EstimateContractor | null;
  // Кол-во комментариев к виду работ (в контексте сметы) — для бейджа на иконке-конверте.
  commentCount?: number;
  // Шифры РД, назначенные виду работ (в контексте сметы).
  ciphers?: { id: string; code: string }[];
}

export const formatMoney = (v: string | number | null | undefined) =>
  `${Number(v ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

/**
 * Какие цены показывают столбцы «Цена»/«Сумма»: базовые из справочника расценок («Смета») или
 * договорные из заполненного подрядчиком ВОР («Подрядчики»). Базовые в разделе подрядчиков не
 * показываются вовсе — там цена означает договор, а не расценку.
 */
export type PriceMode = 'base' | 'contract';

interface PricedRow {
  unit_price: string;
  total: string;
  contract_unit_price?: string | null;
  contract_total?: string | null;
}

/** Цена строки в выбранном режиме; null — договорной цены ещё нет. */
export const priceOf = (r: PricedRow, mode: PriceMode): string | null =>
  mode === 'contract' ? r.contract_unit_price ?? null : r.unit_price;

/** Сумма строки в выбранном режиме; null — договорной цены ещё нет. */
export const totalOf = (r: PricedRow, mode: PriceMode): string | null =>
  mode === 'contract' ? r.contract_total ?? null : r.total;

/** Деньги или прочерк: «нет договорной цены» — это не ноль, и выглядеть как ноль не должно. */
export const formatMoneyOrDash = (v: string | number | null | undefined) =>
  v === null || v === undefined ? '—' : formatMoney(v);

/** Сумма работ с их материалами в выбранном режиме (строки без договорной цены идут нулём). */
export const sumWorksTotal = (works: EstimateItem[], mode: PriceMode): number =>
  works.reduce(
    (acc, w) =>
      acc +
      Number(totalOf(w, mode) ?? 0) +
      w.materials.reduce((a, m) => a + Number(totalOf(m, mode) ?? 0), 0),
    0,
  );

const GROUP_NONE = '__none__';

// Сгруппировать работы по виду затрат, домешав подрядчиков и «отложенные»
// (добавленные в UI, ещё без работ) виды затрат. Сортировка по категории/виду.
export function buildCostTypeGroups(
  items: EstimateItem[],
  contractors: EstimateContractor[],
  pending: CostTypeGroup[] = [],
  costTypeCommentCounts?: Record<string, number>,
  costTypeCiphers?: CostTypeCiphers,
): CostTypeGroup[] {
  const map = new Map<string, CostTypeGroup>();
  const keyOf = (id: string | null) => id ?? GROUP_NONE;

  const ensure = (id: string | null): CostTypeGroup => {
    const k = keyOf(id);
    let g = map.get(k);
    if (!g) {
      g = {
        costTypeId: id,
        costTypeName: null,
        costTypeSortOrder: null,
        costCategoryId: null,
        costCategoryName: null,
        costCategorySortOrder: null,
        works: [],
        contractor: null,
      };
      map.set(k, g);
    }
    return g;
  };

  for (const it of items) {
    const g = ensure(it.cost_type_id);
    g.costTypeName ??= it.cost_type_name ?? null;
    g.costTypeSortOrder ??= it.cost_type_sort_order ?? null;
    g.costCategoryId ??= it.cost_category_id ?? null;
    g.costCategoryName ??= it.cost_category_name ?? null;
    g.costCategorySortOrder ??= it.cost_category_sort_order ?? null;
    g.works.push(it);
  }

  for (const p of pending) {
    const g = ensure(p.costTypeId);
    g.costTypeName ??= p.costTypeName;
    g.costTypeSortOrder ??= p.costTypeSortOrder;
    g.costCategoryId ??= p.costCategoryId;
    g.costCategoryName ??= p.costCategoryName;
    g.costCategorySortOrder ??= p.costCategorySortOrder;
  }

  for (const c of contractors) {
    const g = ensure(c.cost_type_id);
    g.contractor = c;
    g.costTypeName ??= c.cost_type_name ?? null;
    g.costTypeSortOrder ??= c.cost_type_sort_order ?? null;
    g.costCategoryId ??= c.cost_category_id ?? null;
    g.costCategoryName ??= c.cost_category_name ?? null;
    g.costCategorySortOrder ??= c.cost_category_sort_order ?? null;
  }

  // Порядок групп — как в справочнике: сначала по sort_order категории, затем по sort_order
  // вида работ. Имя — вторичный ключ (после импорта Excel все sort_order = 0). Группы без
  // sort_order (отложенные, ещё без работ) падают в конец.
  // Счётчик комментариев вида работ (для бейджа на конверте в заголовке блока).
  if (costTypeCommentCounts) {
    for (const g of map.values()) {
      g.commentCount = g.costTypeId ? costTypeCommentCounts[g.costTypeId] ?? 0 : 0;
    }
  }
  if (costTypeCiphers) {
    for (const g of map.values()) {
      g.ciphers = g.costTypeId ? costTypeCiphers[g.costTypeId] ?? [] : [];
    }
  }

  const catRank = (g: CostTypeGroup) => g.costCategorySortOrder ?? Number.MAX_SAFE_INTEGER;
  const typeRank = (g: CostTypeGroup) => g.costTypeSortOrder ?? Number.MAX_SAFE_INTEGER;
  return [...map.values()].sort((a, b) => {
    const cr = catRank(a) - catRank(b);
    if (cr !== 0) return cr;
    const cn = (a.costCategoryName ?? '').localeCompare(b.costCategoryName ?? '', 'ru');
    if (cn !== 0) return cn;
    const tr = typeRank(a) - typeRank(b);
    if (tr !== 0) return tr;
    return (a.costTypeName ?? '').localeCompare(b.costTypeName ?? '', 'ru');
  });
}
