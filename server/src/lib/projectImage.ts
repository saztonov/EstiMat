import type { FastifyInstance } from 'fastify';

// Легаси-обложки хранились на локальном диске под /uploads/projects/<имя>.
// Новые — ключи объектов S3 (без префикса /uploads/).
export function isLegacyLocalImage(value: string): boolean {
  return value.startsWith('/uploads/');
}

// Обложка проекта (§15): image_url в БД — ключ объекта S3 (или легаси-локальный путь).
// Для показа добавляем image_src — ссылку на наш прокси GET /api/projects/cover/<key>,
// не меняя сам image_url (round-trip формы сохраняет ключ). Прокси нужен, чтобы браузер
// не ходил в Cloud.ru напрямую: прямой путь до стороннего хоста S3 в части клиентских
// сетей не проходит (обрыв передачи файла), хотя VPS до S3 достучивается без проблем.
export function withImageSrc<T extends { image_url?: string | null }>(
  fastify: FastifyInstance,
  row: T,
): T & { image_src: string | null } {
  const img = row.image_url ?? null;
  if (img && fastify.storage && !isLegacyLocalImage(img)) {
    return { ...row, image_src: `/api/projects/cover/${img}` };
  }
  return { ...row, image_src: img };
}
