import { z } from 'zod';

// Цель комментария: строка работы (estimate_items) либо вид работ (cost_types в контексте сметы).
export const commentTargetTypeSchema = z.enum(['work', 'cost_type']);
export type CommentTargetType = z.infer<typeof commentTargetTypeSchema>;

// Создание комментария. targetId — id работы (для work) либо id вида работ (для cost_type).
export const createEstimateCommentSchema = z.object({
  targetType: commentTargetTypeSchema,
  targetId: z.string().uuid(),
  body: z.string().trim().min(1, 'Комментарий не может быть пустым').max(2000, 'Максимум 2000 символов'),
});
export type CreateEstimateCommentInput = z.infer<typeof createEstimateCommentSchema>;

// Редактирование комментария (меняется только текст).
export const updateEstimateCommentSchema = z.object({
  body: z.string().trim().min(1, 'Комментарий не может быть пустым').max(2000, 'Максимум 2000 символов'),
});
export type UpdateEstimateCommentInput = z.infer<typeof updateEstimateCommentSchema>;

// DTO ответа: сервер отдаёт camelCase (createdByName — денормализованное ФИО автора).
export const estimateCommentSchema = z.object({
  id: z.string().uuid(),
  estimateId: z.string().uuid(),
  targetType: commentTargetTypeSchema,
  targetId: z.string().uuid(),
  body: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EstimateComment = z.infer<typeof estimateCommentSchema>;
