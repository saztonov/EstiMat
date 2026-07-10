import { z } from 'zod';

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
});

// Отметка строки: в какие ВОР входит работа (для метки «В»). Порядок — created_at DESC.
export const vorMarkSchema = z.object({ id: z.string().uuid(), name: z.string() });

export type VorFilterSelection = z.infer<typeof vorFilterSelectionSchema>;
export type VorFilterSnapshot = z.infer<typeof vorFilterSnapshotSchema>;
export type CreateEstimateVorInput = z.infer<typeof createEstimateVorInputSchema>;
export type EstimateVor = z.infer<typeof estimateVorSchema>;
export type VorMark = z.infer<typeof vorMarkSchema>;
// itemId → список ВОР, в которые входит строка.
export type VorMarksMap = Record<string, VorMark[]>;
