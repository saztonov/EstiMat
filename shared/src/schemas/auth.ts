import { z } from 'zod';
import { ROLES } from '../constants/roles.js';

// Единый канон email во всём приложении: trim + нижний регистр, затем валидация формата.
// Порядок цепочки важен — нормализация до .email(). SQL-слой сравнивает по lower(btrim(email)).
export const emailSchema = z.string().trim().toLowerCase().email('Некорректный email');

// bcrypt использует только первые 72 БАЙТА пароля (не символа), остальное молча отбрасывает.
// Для НОВЫХ и сменяемых паролей ограничиваем длину явно, чтобы «…длинный хвост» не создавал
// ложного ощущения стойкости. TextEncoder есть и в браузере, и в Node — Buffer тут нельзя.
export const MAX_PASSWORD_BYTES = 72;
const withinBcrypt = (v: string) => new TextEncoder().encode(v).length <= MAX_PASSWORD_BYTES;
export const newPasswordSchema = z
  .string()
  .min(6, 'Минимум 6 символов')
  .refine(withinBcrypt, 'Пароль слишком длинный (максимум 72 байта)');

export const loginSchema = z.object({
  email: emailSchema,
  // Вход: длину bcrypt-границей НЕ ограничиваем — иначе легаси-пароли, заведённые
  // без лимита, стали бы невводимыми. Только разумный транспортный предел.
  password: z.string().min(1, 'Введите пароль').max(200),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  fullName: z.string().min(2, 'Минимум 2 символа').max(200),
});

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  orgId: z.string().uuid().nullable(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type User = z.infer<typeof userSchema>;
