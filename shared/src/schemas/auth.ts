import { z } from 'zod';
import { ROLES } from '../constants/roles.js';

// Единый канон email во всём приложении: trim + нижний регистр, затем валидация формата.
// Порядок цепочки важен — нормализация до .email(). SQL-слой сравнивает по lower(btrim(email)).
export const emailSchema = z.string().trim().toLowerCase().email('Некорректный email');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'Минимум 6 символов'),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'Минимум 6 символов'),
  fullName: z.string().min(2, 'Минимум 2 символа'),
  phone: z.string().optional(),
});

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  orgId: z.string().uuid().nullable(),
  role: z.enum(ROLES),
  phone: z.string().nullable(),
  isActive: z.boolean(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type User = z.infer<typeof userSchema>;
