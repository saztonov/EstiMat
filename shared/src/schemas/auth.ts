import { z } from 'zod';
import { ROLES } from '../constants/roles.js';

export const loginSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
});

export const registerSchema = z.object({
  email: z.string().email('Некорректный email'),
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
