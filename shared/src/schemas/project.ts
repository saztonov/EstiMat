import { z } from 'zod';
import { PROJECT_STATUSES } from '../constants/statuses.js';

// Обложка объекта — ТОЛЬКО ключ, который выдал сам сервер при загрузке:
//   S3     — projects/<uuid>.<растровое расширение>
//   legacy — /uploads/projects/<имя файла> (локальная разработка без S3)
// Свободную строку принимать нельзя: image_url потом удаляется как «предыдущая обложка»
// (removeUpload), и произвольный ключ в теле запроса позволял бы стереть чужой объект S3.
export const COVER_KEY_RE =
  /^(projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp)|\/uploads\/projects\/[A-Za-z0-9._-]+)$/i;

// Пустую строку из формы трактуем как «нет обложки» (null).
const imageUrlSchema = z.preprocess(
  (v) => (v === '' ? null : v),
  z.string().regex(COVER_KEY_RE, 'Некорректный ключ обложки').nullable().optional(),
);

export const createProjectSchema = z.object({
  code: z.string().min(3).max(6, 'Код: 3-6 символов'),
  name: z.string().min(1, 'Название обязательно'),
  fullName: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  status: z.enum(PROJECT_STATUSES).default('planning'),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  imageUrl: imageUrlSchema,
});

export const updateProjectSchema = createProjectSchema.partial();

export const projectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  fullName: z.string().nullable(),
  address: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  imageUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type Project = z.infer<typeof projectSchema>;
