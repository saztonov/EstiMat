import { z } from 'zod';

// Действие в журнале изменений.
export const auditActionSchema = z.enum([
  'create',
  'update',
  'delete',
  'reassign',
  'confirm',
  'ai_apply',
  'undo',
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

// Тип сущности журнала.
export const auditEntitySchema = z.enum([
  'estimate',
  'estimate_item',
  'estimate_material',
  'estimate_contractor',
]);
export type AuditEntity = z.infer<typeof auditEntitySchema>;

// Структура поля changes (JSONB): снимки до/после, изменённые поля и трассировка ИИ.
export const auditChangesSchema = z
  .object({
    before: z.record(z.string(), z.unknown()).nullable().optional(),
    after: z.record(z.string(), z.unknown()).nullable().optional(),
    changedFields: z.array(z.string()).optional(),
    source: z.string().optional(),
    reason: z.string().optional(),
    aiJobId: z.string().uuid().nullable().optional(),
    aiChatId: z.string().uuid().nullable().optional(),
    // Для переноса материала.
    oldItemId: z.string().uuid().nullable().optional(),
    newItemId: z.string().uuid().nullable().optional(),
    // Для сводной записи ai_apply.
    works: z.number().int().optional(),
    materials: z.number().int().optional(),
  })
  .passthrough();
export type AuditChanges = z.infer<typeof auditChangesSchema>;

// Готовая к показу строка изменения: подпись поля + значения «до»/«после» как строки.
// Сервер резолвит UUID в имена (виды работ, расценки, зоны, типы…) и форматирует
// locations — клиенту остаётся только отрисовать.
export const auditChangeViewSchema = z.object({
  key: z.string(),
  label: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type AuditChangeView = z.infer<typeof auditChangeViewSchema>;

// Запись истории (read-модель для ленты «История»). action/entityType хранятся как
// строки в БД — на чтении не валидируем жёстко enum'ом, чтобы пережить legacy-значения.
export const auditLogEntrySchema = z.object({
  id: z.string().uuid(),
  estimateId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  action: z.string(),
  userId: z.string().uuid().nullable(),
  userName: z.string().nullable().optional(),
  correlationId: z.string().uuid().nullable().optional(),
  changes: auditChangesSchema.nullable(),
  // Готовые к показу изменения (резолвятся сервером для update/confirm); иначе null.
  changesView: z.array(auditChangeViewSchema).nullable().optional(),
  createdAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

// ── Отмена действий (undo) ─────────────────────────────────────────────────
// Тип обратимой операции (единица отмены = correlation-группа записей журнала).
export const undoOperationKindSchema = z.enum([
  'item_create',
  'item_update',
  'item_delete',
  'material_create',
  'material_update',
  'material_delete',
  'bulk_delete',
]);
export type UndoOperationKind = z.infer<typeof undoOperationKindSchema>;

// Что отменится следующим нажатием (для активности кнопки и подсказки).
export const undoTargetSchema = z.object({
  available: z.boolean(),
  correlationId: z.string().uuid().nullable(),
  operationKind: undoOperationKindSchema.nullable(),
  summary: z.string().nullable(),
});
export type UndoTarget = z.infer<typeof undoTargetSchema>;

// Ответ GET /undo/peek.
export const undoPeekResponseSchema = z.object({
  undo: undoTargetSchema.nullable(),
});
export type UndoPeekResponse = z.infer<typeof undoPeekResponseSchema>;

// Ответ POST /undo (успешная отмена).
export const undoResultSchema = z.object({
  undone: z.literal(true),
  correlationId: z.string().uuid(),
  operationKind: undoOperationKindSchema,
  summary: z.string(),
});
export type UndoResult = z.infer<typeof undoResultSchema>;
