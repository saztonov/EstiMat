import { z } from 'zod';
import { assignBlockedItemSchema } from './estimate.js';

// ВОР (ведомость объёмов работ) — сохранённая именованная выгрузка сметы в Excel.
// Клиент отправляет машинные значения фильтров (ID), сервер разрешает их в подписи и хранит
// исторический снимок (vorFilterSnapshot). См. server/src/routes/estimates/vor.ts.

// Базовое имя файла ВОР: без управляющих (0x00–0x1f, 0x7f), path (/ \) и header (") символов,
// без «..». Пробелы/точки/дефисы разрешены. Расширение «.xlsx» допускается (сервер нормализует
// и добавит ровно одно). Пустое имя недопустимо. Проверка по код-поинтам, чтобы не тянуть
// control-символы в regex (eslint no-control-regex).
const vorNameSchema = z
  .string()
  .trim()
  .min(1, 'Введите название')
  .max(150, 'Название: до 150 символов')
  .refine(
    (s) =>
      !s.includes('..') &&
      ![...s].some((ch) => {
        const c = ch.charCodeAt(0);
        return c < 0x20 || c === 0x7f || ch === '/' || ch === '\\' || ch === '"';
      }),
    'Недопустимые символы в названии',
  );

// Машинные значения применённых фильтров (что отправляет клиент при создании ВОР).
export const vorFilterSelectionSchema = z.object({
  categoryIds: z.array(z.string().uuid()).default([]),
  typeIds: z.array(z.string().uuid()).default([]),
  zoneIds: z.array(z.string().uuid()).default([]),
  floorsText: z.string().default(''),
  locationTypeIds: z.array(z.string().uuid()).default([]),
  volumeType: z.enum(['all', 'main', 'additional']).default('all'),
  onlyUnreconciled: z.boolean().default(false),
});

// Пара «id + подпись» для снимка фильтра (подписи разрешает сервер по справочникам сметы).
const labeledIdSchema = z.object({ id: z.string().uuid(), name: z.string() });

// Исторический снимок фильтров (ID + подписи) — хранится в JSONB и отдаётся в списке ВОР.
export const vorFilterSnapshotSchema = z.object({
  categories: z.array(labeledIdSchema).default([]),
  types: z.array(labeledIdSchema).default([]),
  zones: z.array(labeledIdSchema).default([]),
  floorsText: z.string().default(''),
  locationTypes: z.array(labeledIdSchema).default([]),
  volumeType: z.enum(['all', 'main', 'additional']).default('all'),
  onlyUnreconciled: z.boolean().default(false),
});

// Тело POST /:id/vors — создать ВОР (экспорт + сохранение).
export const createEstimateVorInputSchema = z
  .object({
    // Идемпотентность: повтор с тем же requestId вернёт уже созданную запись/файл.
    requestId: z.string().uuid(),
    name: vorNameSchema,
    items: z
      .array(z.object({ id: z.string().uuid(), locationLabel: z.string() }))
      .min(1, 'Нет строк для экспорта')
      .max(20000),
    filters: vorFilterSelectionSchema,
    // Пропустить конфликт единиц измерения и всё равно собрать файл (см. export).
    ignoreUnitConflicts: z.boolean().optional(),
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.id)).size === v.items.length,
    'Повторяющиеся строки в запросе',
  );

// Состояние строки относительно ВОР: не изменилась / изменилась после выгрузки / удалена из
// сметы / неизвестно (легаси-ВОР без снимка или неподдерживаемая версия схемы).
export const vorItemStateSchema = z.enum(['unchanged', 'changed', 'deleted', 'unknown']);

// Счётчики актуальности ВОР (в списке «Созданные ВОР»).
export const vorCountsSchema = z.object({
  total: z.number().int(),
  changed: z.number().int(),
  deleted: z.number().int(),
  unknown: z.number().int(),
});

// Исторические фасеты содержимого ВОР: что реально было в файле (из построчного снимка).
// Пусто у легаси-ВОР без снимка.
export const vorContentFacetsSchema = z.object({
  locations: z.array(z.string()).default([]),
  types: z.array(z.string()).default([]),
});

// Строка списка «Созданные ВОР».
export const estimateVorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string(),
  createdByName: z.string(),
  fileName: z.string(),
  filters: vorFilterSnapshotSchema,
  // Можно ли удалить (автор или admin) — считает сервер по текущему пользователю.
  canDelete: z.boolean(),
  // Есть ли построчный снимок для точного diff (false у легаси-ВОР).
  diffAvailable: z.boolean(),
  counts: vorCountsSchema,
  // Местоположения и типы строк ВОР — как они были на момент выгрузки.
  facets: vorContentFacetsSchema,
});

// Агрегатная отметка строки сметы: обобщённый статус по всем ВОР, куда входит работа.
export const vorMarkSchema = z.object({
  // Худший actionable-статус: changed > unknown > unchanged (deleted-строк в отметках нет —
  // их нет в таблице сметы; они видны только в списке ВОР).
  state: vorItemStateSchema,
  vorCount: z.number().int(),
  changedCount: z.number().int(),
  unknownCount: z.number().int(),
  // Список ВОР строки (created_at DESC) — имя + статус, для подсказки к метке «В».
  vors: z.array(z.object({ name: z.string(), state: vorItemStateSchema })),
});

// Статус строки относительно конкретного ВОР (ленивая детализация по клику).
export const vorItemVorStatusSchema = z.object({
  vorId: z.string().uuid(),
  name: z.string(),
  createdAt: z.string(),
  state: vorItemStateSchema,
});

// diff «было в ВОР → стало сейчас».
export const vorFieldChangeSchema = z.object({
  key: z.string(),
  label: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export const vorMaterialChangeSchema = z.object({
  kind: z.enum(['added', 'removed', 'changed']),
  name: z.string(),
  fields: z.array(vorFieldChangeSchema).optional(),
});
export const vorItemDiffSchema = z.object({
  itemId: z.string().uuid(),
  name: z.string(),
  state: z.enum(['unchanged', 'changed', 'deleted']),
  fields: z.array(vorFieldChangeSchema),
  materials: z.array(vorMaterialChangeSchema),
});
export const vorDiffResponseSchema = z.object({
  vorId: z.string().uuid(),
  // false → снимок недоступен/повреждён: статусы всё равно даны, но подробности неполны.
  manifestOk: z.boolean(),
  counts: vorCountsSchema,
  items: z.array(vorItemDiffSchema),
});

// ── Назначение подрядчика на ВОР (раздел «Подрядчики») ──────────────────────
//
// Строка области ВОР: историческое (как в файле) + текущее (как в смете) состояние. Отбор по
// локации и типу идёт по историческим значениям — их подрядчик видит в присланном файле; отбор
// по категории и виду работ — по текущим: в файле ВОР этих колонок нет вовсе.
export const vorScopeItemSchema = z.object({
  itemId: z.string().uuid(),
  description: z.string(),
  snapshotLocationLabel: z.string().nullable(),
  snapshotTypeName: z.string().nullable(),
  costCategoryId: z.string().uuid().nullable(),
  costCategoryName: z.string().nullable(),
  costTypeId: z.string().uuid().nullable(),
  costTypeName: z.string().nullable(),
  zones: z.array(z.object({ id: z.string().uuid(), name: z.string() })).default([]),
  locationTypeId: z.string().uuid().nullable(),
  locationTypeName: z.string().nullable(),
  /** Подрядчики, назначенные на строку сейчас. */
  assignedContractorIds: z.array(z.string().uuid()).default([]),
  /** По строке уже оформлена заявка на материалы — исполнителя не сменить. */
  requestLocked: z.boolean(),
  state: vorItemStateSchema,
});

// Значение отбора: id справочника либо явное «Без ...» (у строки поле не заполнено).
const facetValueSchema = z.union([z.string().uuid(), z.literal('none')]);

// Пустой список = «все»; внутри списка — ИЛИ, между списками — И.
export const vorAssignFiltersSchema = z.object({
  categoryIds: z.array(facetValueSchema).default([]),
  typeIds: z.array(facetValueSchema).default([]),
  zoneIds: z.array(facetValueSchema).default([]),
  locationTypeIds: z.array(facetValueSchema).default([]),
});

// Тело POST /:id/vors/:vorId/assign. Строки НЕ передаются: сервер берёт состав ВОР сам, поэтому
// назначить работу вне этого ВОР невозможно даже подделанным запросом.
export const vorAssignInputSchema = z.object({
  contractorId: z.string().uuid(),
  scope: z.enum(['all', 'filters']),
  filters: vorAssignFiltersSchema.default({
    categoryIds: [],
    typeIds: [],
    zoneIds: [],
    locationTypeIds: [],
  }),
});

export const vorAssignResultSchema = z.object({
  assigned: z.number().int(),
  replacedRows: z.number().int(),
  blocked: z.array(assignBlockedItemSchema),
  /** Строки ВОР, удалённые из сметы — назначать нечего. */
  deletedSkipped: z.number().int(),
  /** Строк, у которых снята договорная цена прежнего исполнителя. */
  clearedPrices: z.number().int(),
});

// ── Импорт договорных цен из заполненного ВОР ───────────────────────────────
// Позиция, из-за которой импорт отклонён (цена не найдена/не распознана/строка не сопоставлена).
export const vorPriceIssueSchema = z.object({
  kind: z.enum(['work', 'material']),
  /** Номер строки в «КП» («12», «12.3») — по нему позиция ищется в файле. */
  number: z.string().nullable(),
  name: z.string(),
  reason: z.enum(['no_price', 'bad_price', 'not_matched', 'changed']),
});

export const vorPriceImportResultSchema = z.object({
  worksUpdated: z.number().int(),
  materialsUpdated: z.number().int(),
  /** Строки файла, назначенные не выбранному подрядчику — их цены не трогаем. */
  skippedOtherContractor: z.number().int(),
  uploadId: z.string().uuid().nullable(),
});

// Отбор строк ВОР под назначение. Живёт в shared, потому что считается дважды: сервером —
// как фактическая область назначения, клиентом — как счётчик «строк попадёт» в модалке. Разъедься
// эти две реализации, интерфейс обещал бы одно, а назначалось бы другое.
//
// Правила: пустой список внутри фильтра = «все значения»; внутри фильтра — ИЛИ, между
// фильтрами — И; 'none' — явное «Без категории/вида/локации/типа»; удалённая из сметы строка не
// назначается никогда.
function matchesFacet(values: string[], selected: string[]): boolean {
  if (selected.length === 0) return true;
  if (values.length === 0) return selected.includes('none');
  return values.some((v) => selected.includes(v));
}

export function filterVorScope(
  items: VorScopeItem[],
  scope: 'all' | 'filters',
  filters: VorAssignFilters,
): VorScopeItem[] {
  const live = items.filter((it) => it.state !== 'deleted');
  if (scope === 'all') return live;
  return live.filter(
    (it) =>
      matchesFacet(it.costCategoryId ? [it.costCategoryId] : [], filters.categoryIds) &&
      matchesFacet(it.costTypeId ? [it.costTypeId] : [], filters.typeIds) &&
      matchesFacet(it.zones.map((z) => z.id), filters.zoneIds) &&
      matchesFacet(it.locationTypeId ? [it.locationTypeId] : [], filters.locationTypeIds),
  );
}

export type VorFilterSelection = z.infer<typeof vorFilterSelectionSchema>;
export type VorContentFacets = z.infer<typeof vorContentFacetsSchema>;
export type VorScopeItem = z.infer<typeof vorScopeItemSchema>;
export type VorAssignFilters = z.infer<typeof vorAssignFiltersSchema>;
export type VorAssignInput = z.infer<typeof vorAssignInputSchema>;
export type VorAssignResult = z.infer<typeof vorAssignResultSchema>;
export type VorPriceIssue = z.infer<typeof vorPriceIssueSchema>;
export type VorPriceImportResult = z.infer<typeof vorPriceImportResultSchema>;
export type VorFilterSnapshot = z.infer<typeof vorFilterSnapshotSchema>;
export type CreateEstimateVorInput = z.infer<typeof createEstimateVorInputSchema>;
export type EstimateVor = z.infer<typeof estimateVorSchema>;
export type VorItemState = z.infer<typeof vorItemStateSchema>;
export type VorCounts = z.infer<typeof vorCountsSchema>;
export type VorMark = z.infer<typeof vorMarkSchema>;
// itemId → агрегатная отметка строки.
export type VorMarksMap = Record<string, VorMark>;
export type VorItemVorStatus = z.infer<typeof vorItemVorStatusSchema>;
export type VorFieldChange = z.infer<typeof vorFieldChangeSchema>;
export type VorMaterialChange = z.infer<typeof vorMaterialChangeSchema>;
export type VorItemDiff = z.infer<typeof vorItemDiffSchema>;
export type VorDiffResponse = z.infer<typeof vorDiffResponseSchema>;
