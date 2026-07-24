import type { FastifyInstance } from 'fastify';
import { unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { COVER_KEY_RE } from '@estimat/shared';
import { requireRole } from '../../middleware/requireRole.js';
import { isLegacyLocalImage } from '../../lib/projectImage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// ВАЖНО: путь относительный от глубины routes/projects/ — файл должен оставаться на ней.
const UPLOADS_ROOT = join(__dirname, '..', '..', '..', 'uploads');

// Content-Type обложки выводим из расширения ключа по белому списку растровых картинок,
// а НЕ из сохранённого в S3 значения (оно задаётся клиентским mimetype при загрузке).
// Иначе объект с типом text/html или image/svg+xml, отданный с нашего origin, дал бы
// stored XSS. Загрузка и так принимает только эти типы — список держим согласованным.
const COVER_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// Удаление прежней обложки при замене: локальный файл — unlink, объект S3 —
// deleteObject (идемпотентно, §15). Используется также в core.ts (PUT /:id).
export async function removeUpload(fastify: FastifyInstance, value: string | null | undefined) {
  if (!value) return;
  // Удаляем только собственные ключи обложек. Даже если в image_url когда-то попал
  // посторонний ключ — по формату он сюда не пройдёт (защита от стирания чужого объекта S3).
  if (!COVER_KEY_RE.test(value)) return;
  if (isLegacyLocalImage(value)) {
    if (!value.startsWith('/uploads/projects/')) return;
    const name = value.slice('/uploads/projects/'.length);
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return;
    try {
      await unlink(join(UPLOADS_ROOT, 'projects', name));
    } catch {
      // файл мог быть удалён ранее — игнорируем
    }
    return;
  }
  if (!fastify.storage) return;
  // Ключ обложки не привязан к конкретному проекту (генерируется до создания объекта),
  // поэтому перед удалением убеждаемся, что на него не ссылается НИ ОДИН проект. Иначе
  // подстановкой чужого ключа в свой image_url можно было бы стереть обложку другого объекта.
  const { rows } = await fastify.pool.query(
    'SELECT 1 FROM projects WHERE image_url = $1 LIMIT 1',
    [value],
  );
  if (rows.length > 0) return;
  await fastify.storage.deleteObject(value);
}

// Обложки объектов: прокси чтения из S3.
export function registerCoverRoutes(fastify: FastifyInstance): void {
  // GET /api/projects/cover/* — прокси чтения обложки из S3. Браузер берёт обложку
  // с нашего домена (а сервер сам тянет объект из Cloud.ru), чтобы не зависеть от
  // прямого сетевого пути клиент → S3. Ключ объекта (projects/<uuid>.<ext>) — в wildcard.
  fastify.get<{ Params: { '*': string } }>(
    '/cover/*',
    {
      // contractor тоже видит обложки своих объектов в разделе «Подрядчики».
      // Ключ — UUID, в списке подрядчик видит только свои объекты — риск перебора минимален.
      preHandler: [requireRole('admin', 'engineer', 'manager', 'contractor')],
      // Обложка встраивается в SPA с другого origin (домен API ≠ домен SPA), поэтому
      // дефолтный helmet CORP=same-origin её режет (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin).
      // Для картинки разрешаем кросс-доменное встраивание (прочитать содержимое cross-origin
      // всё равно нельзя — это просто изображение). Переопределение точечное, на этот роут.
      helmet: { crossOriginResourcePolicy: { policy: 'cross-origin' } },
    },
    async (request, reply) => {
      const key = request.params['*'];
      // Только обложки проектов; защита от обхода путей и легаси-локальных файлов.
      if (!key.startsWith('projects/') || key.includes('..')) {
        return reply.status(400).send({ error: 'Некорректный ключ объекта' });
      }
      // Тип — из расширения по белому списку, не из сохранённого в S3 (анти-XSS).
      const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
      const contentType = COVER_MIME[ext];
      if (!contentType) return reply.status(400).send({ error: 'Неподдерживаемый тип обложки' });
      if (!fastify.storage) return reply.status(404).send({ error: 'Хранилище не настроено' });
      try {
        const obj = await fastify.storage.getObject(key);
        reply.type(contentType);
        if (obj.contentLength != null) reply.header('Content-Length', obj.contentLength);
        // Анти-XSS: тип не угадывать по содержимому, как документ не исполнять, отдавать inline.
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Content-Disposition', 'inline; filename="cover"');
        // Ключ контент-адресный (UUID) — содержимое неизменно, кэшируем «навсегда».
        reply.header('Cache-Control', 'private, max-age=31536000, immutable');
        return reply.send(obj.body);
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === 'NoSuchKey' || name === 'NotFound') {
          return reply.status(404).send({ error: 'Обложка не найдена' });
        }
        throw err;
      }
    },
  );
}
