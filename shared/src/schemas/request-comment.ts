import { z } from 'zod';
import { COMMENT_RECIPIENTS } from '../constants/statuses.js';

// Комментарий в чате заявки. recipient: null = «Всем».
export const createRequestCommentSchema = z.object({
  text: z.string().min(1).max(4000),
  recipient: z.enum(COMMENT_RECIPIENTS).nullish(),
});
export type CreateRequestCommentInput = z.infer<typeof createRequestCommentSchema>;

export const updateRequestCommentSchema = z.object({
  text: z.string().min(1).max(4000),
});
export type UpdateRequestCommentInput = z.infer<typeof updateRequestCommentSchema>;
