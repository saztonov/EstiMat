import { z } from 'zod';

// Версия протокола realtime — для совместимости клиента и сервера при изменениях формата.
export const REALTIME_PROTOCOL_VERSION = 1;

// Причина изменения сметы (для тихого уведомления и отладки).
export const estimateChangeReasonSchema = z.enum([
  'item_created',
  'item_updated',
  'item_deleted',
  'material_created',
  'material_updated',
  'material_deleted',
  'materials_reassigned',
  'bulk_deleted',
  'confirmed_all',
  'contractor_set',
  'contractor_cleared',
  'ai_applied',
  'estimate_updated',
]);
export type EstimateChangeReason = z.infer<typeof estimateChangeReasonSchema>;

// Событие «смета изменилась» (сервер → клиент). correlationId/auditLogId связывают
// событие с записью истории (audit_log).
export const estimateChangedEventSchema = z.object({
  protocolVersion: z.number().int(),
  eventId: z.string(),
  estimateId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  reason: estimateChangeReasonSchema,
  actorUserId: z.string().uuid().nullable(),
  changedAt: z.string(),
  correlationId: z.string().uuid().nullable().optional(),
  auditLogId: z.string().uuid().nullable().optional(),
});
export type EstimateChangedEvent = z.infer<typeof estimateChangedEventSchema>;

// Входящее сообщение клиента по WS (валидируется на сервере).
export const realtimeClientMessageSchema = z.object({
  type: z.literal('subscribe_estimate'),
  estimateId: z.string().uuid(),
});
export type RealtimeClientMessage = z.infer<typeof realtimeClientMessageSchema>;
