import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { emailSchema, newPasswordSchema } from './auth.js';

export const createUserSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  fullName: z.string().min(2, 'Минимум 2 символа').max(200),
  role: z.enum(ROLES),
  orgId: z.string().uuid().nullable().optional(),
});

export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  fullName: z.string().min(2).max(200).optional(),
  role: z.enum(ROLES).optional(),
  orgId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  newPassword: newPasswordSchema,
});

// Самостоятельная смена пароля в личном кабинете — с проверкой текущего пароля.
// currentPassword bcrypt-границей не ограничиваем (легаси-пароль мог быть длиннее).
export const selfChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль').max(200),
  newPassword: newPasswordSchema,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SelfChangePasswordInput = z.infer<typeof selfChangePasswordSchema>;
