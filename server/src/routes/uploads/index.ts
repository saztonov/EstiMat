import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const EXT_TO_MIME: Record<'jpg' | 'png' | 'webp', string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const COVER_MAX_BYTES = 10 * 1024 * 1024;

// Формат определяем по СИГНАТУРЕ содержимого, а не по mimetype от клиента: иначе можно
// подсунуть не-картинку с типом image/png. JPEG/PNG/WebP — единственные допустимые обложки.
function detectImageExt(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  const at = (i: number, x: number) => buf[i] === x;
  if (at(0, 0xff) && at(1, 0xd8) && at(2, 0xff)) return 'jpg';
  if (at(0, 0x89) && at(1, 0x50) && at(2, 0x4e) && at(3, 0x47)) return 'png';
  // RIFF....WEBP
  if (at(0, 0x52) && at(1, 0x49) && at(2, 0x46) && at(3, 0x46)
    && at(8, 0x57) && at(9, 0x45) && at(10, 0x42) && at(11, 0x50)) return 'webp';
  return null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = join(__dirname, '..', '..', '..', 'uploads');
const PROJECTS_DIR = join(UPLOADS_ROOT, 'projects');

export default async function uploadsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // POST /api/uploads/image — загрузка изображения проекта
  fastify.post(
    '/image',
    { preHandler: [requireRole('admin', 'manager')] },
    async (request, reply) => {
      // Пер-роут лимит 10 МБ (обложка — не документ; глобальный multipart 50 МБ тут велик).
      const file = await request.file({ limits: { fileSize: COVER_MAX_BYTES } });
      if (!file) return reply.status(400).send({ error: 'Файл не загружен' });

      const buffer = await file.toBuffer();
      if (file.file.truncated) {
        return reply.status(413).send({ error: 'Файл больше 10 МБ' });
      }

      // Тип — по сигнатуре содержимого, не по клиентскому mimetype.
      const ext = detectImageExt(buffer);
      if (!ext) {
        return reply.status(400).send({ error: 'Поддерживаются только JPEG, PNG и WebP' });
      }
      const mime = EXT_TO_MIME[ext];

      // S3-хранилище (§15): ключ генерирует бэкенд, в БД пишется ключ объекта.
      // url для превью — ссылка на прокси API (как и постоянная обложка), а не
      // presigned-URL, чтобы превью сразу после загрузки не шло в Cloud.ru напрямую.
      if (fastify.storage) {
        const key = `projects/${randomUUID()}.${ext}`;
        await fastify.storage.putObject(key, buffer, mime);
        return reply.status(201).send({ key, url: `/api/projects/cover/${key}` });
      }

      // Фолбэк для локальной разработки без S3 — запись на диск.
      const name = `${randomUUID()}.${ext}`;
      await mkdir(PROJECTS_DIR, { recursive: true });
      await writeFile(join(PROJECTS_DIR, name), buffer);
      const localUrl = `/uploads/projects/${name}`;
      return reply.status(201).send({ key: localUrl, url: localUrl });
    },
  );
}
