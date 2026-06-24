import { z } from 'zod';

// ============================================================
// Локализация строк сметы — две независимые координаты:
//   * География — зона объекта (корпус/парковка/стилобат/секция), дерево project_zones.
//   * Этажи — диапазон floor_from..floor_to (один этаж = from === to).
//   * Тип помещения — справочник room_types.
// Все координаты опциональны: пусто = «Весь объект / не указано».
// ============================================================

// Контекст локации строки (мержится в create/update item; активный контекст панели).
// Чистый ZodObject (без .refine) — чтобы переживал .merge()/.partial() в estimate.ts.
// Инвариант floorFrom <= floorTo гарантируется CHECK-constraint в БД (chk_estimate_items_floor_range).
export const locationContextSchema = z.object({
  zoneId: z.string().uuid().nullable().optional(),
  floorFrom: z.number().int().nullable().optional(),
  floorTo: z.number().int().nullable().optional(),
  roomTypeId: z.string().uuid().nullable().optional(),
});

// ---------- Зоны объекта ----------

export const zoneKindSchema = z.enum([
  'building',
  'parking',
  'stylobate',
  'section',
  'roof',
  'other',
  'techfloor',
]);

export const createZoneSchema = z
  .object({
    parentId: z.string().uuid().nullable().optional(),
    name: z.string().min(1, 'Название обязательно'),
    kind: zoneKindSchema.default('building'),
    code: z.string().nullable().optional(),
    floorMin: z.number().int().nullable().optional(),
    floorMax: z.number().int().nullable().optional(),
    sortOrder: z.number().int().default(0),
  })
  .refine(
    (d) => d.floorMin == null || d.floorMax == null || d.floorMin <= d.floorMax,
    { message: 'floorMin не может быть больше floorMax', path: ['floorMax'] },
  );

export const updateZoneSchema = z
  .object({
    parentId: z.string().uuid().nullable().optional(),
    name: z.string().min(1).optional(),
    kind: zoneKindSchema.optional(),
    code: z.string().nullable().optional(),
    floorMin: z.number().int().nullable().optional(),
    floorMax: z.number().int().nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine(
    (d) => d.floorMin == null || d.floorMax == null || d.floorMin <= d.floorMax,
    { message: 'floorMin не может быть больше floorMax', path: ['floorMax'] },
  );

// ---------- Пакетное сохранение конструктора локаций ----------
// Конструктор шлёт весь набор зон одним запросом: элемент с id → UPDATE, без id → INSERT.
// Удаление — только явным deletedIds (не «отсутствие в zones»), чтобы не снести зоны,
// созданные параллельно другим пользователем после открытия модалки.

export const bulkZoneSchema = z
  .object({
    id: z.string().uuid().optional(),
    parentId: z.string().uuid().nullable().optional(),
    name: z.string().min(1, 'Название обязательно'),
    kind: zoneKindSchema.default('building'),
    code: z.string().nullable().optional(),
    floorMin: z.number().int().nullable().optional(),
    floorMax: z.number().int().nullable().optional(),
    sortOrder: z.number().int().default(0),
  })
  .refine(
    (d) => d.floorMin == null || d.floorMax == null || d.floorMin <= d.floorMax,
    { message: 'floorMin не может быть больше floorMax', path: ['floorMax'] },
  );

export const bulkZonesSchema = z.object({
  zones: z.array(bulkZoneSchema).max(200),
  deletedIds: z.array(z.string().uuid()).max(200).default([]),
});

// ---------- Типы помещений ----------

export const createRoomTypeSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  code: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const updateRoomTypeSchema = createRoomTypeSchema.partial();

export const setProjectRoomTypesSchema = z.object({
  roomTypeIds: z
    .array(z.string().uuid())
    .max(200)
    .transform((ids) => [...new Set(ids)]),
});

// ---------- Размножение наборов (тиражирование) ----------
// Целевые контуры = декартово произведение zoneIds × roomTypeIds (пустая ось = значение
// источника), диапазон этажей применяется ко всем целям (override) либо берётся у источника.
export const replicateItemsSchema = z
  .object({
    sourceItemIds: z
      .array(z.string().uuid())
      .min(1, 'Не выбрано ни одной строки')
      .max(200, 'Слишком много исходных строк')
      .transform((ids) => [...new Set(ids)]),
    zoneIds: z
      .array(z.string().uuid())
      .max(100)
      .default([])
      .transform((ids) => [...new Set(ids)]),
    roomTypeIds: z
      .array(z.string().uuid())
      .max(100)
      .default([])
      .transform((ids) => [...new Set(ids)]),
    floorFrom: z.number().int().nullable().optional(),
    floorTo: z.number().int().nullable().optional(),
    includeMaterials: z.boolean().default(true),
    skipExisting: z.boolean().default(true),
  })
  .refine(
    (d) =>
      d.zoneIds.length + d.roomTypeIds.length > 0 ||
      d.floorFrom != null ||
      d.floorTo != null,
    { message: 'Не выбрана ни одна целевая локация' },
  )
  .refine(
    (d) => d.floorFrom == null || d.floorTo == null || d.floorFrom <= d.floorTo,
    { message: 'Нижний этаж не может быть больше верхнего', path: ['floorTo'] },
  );

// ---------- Типы ----------

export type LocationContext = z.infer<typeof locationContextSchema>;
export type ZoneKind = z.infer<typeof zoneKindSchema>;
export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;
export type BulkZoneInput = z.infer<typeof bulkZoneSchema>;
export type BulkZonesInput = z.infer<typeof bulkZonesSchema>;
export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;
export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>;
export type SetProjectRoomTypesInput = z.infer<typeof setProjectRoomTypesSchema>;
export type ReplicateItemsInput = z.infer<typeof replicateItemsSchema>;
