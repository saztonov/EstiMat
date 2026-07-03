import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { emailSchema } from './auth.js';

export const createUserSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'Минимум 6 символов'),
  fullName: z.string().min(2, 'Минимум 2 символа'),
  role: z.enum(ROLES),
  orgId: z.string().uuid().nullable().optional(),
});

export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  fullName: z.string().min(2).optional(),
  role: z.enum(ROLES).optional(),
  orgId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  newPassword: z.string().min(6, 'Минимум 6 символов'),
});

// Самостоятельная смена пароля в личном кабинете — с проверкой текущего пароля.
export const selfChangePasswordSchema = z.object({
  currentPassword: z.string().min(6, 'Минимум 6 символов'),
  newPassword: z.string().min(6, 'Минимум 6 символов'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SelfChangePasswordInput = z.infer<typeof selfChangePasswordSchema>;
