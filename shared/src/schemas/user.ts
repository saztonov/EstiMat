import { z } from 'zod';
import { ROLES } from '../constants/roles.js';

export const createUserSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
  fullName: z.string().min(2, 'Минимум 2 символа'),
  role: z.enum(ROLES),
  orgId: z.string().uuid().nullable().optional(),
  phone: z.string().optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email('Некорректный email').optional(),
  fullName: z.string().min(2).optional(),
  role: z.enum(ROLES).optional(),
  orgId: z.string().uuid().nullable().optional(),
  phone: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  newPassword: z.string().min(6, 'Минимум 6 символов'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
