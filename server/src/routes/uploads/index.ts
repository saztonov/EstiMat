import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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
      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'Файл не загружен' });

      const ext = MIME_TO_EXT[file.mimetype];
      if (!ext) {
        return reply
          .status(400)
          .send({ error: 'Поддерживаются только JPEG, PNG и WebP' });
      }

      const buffer = await file.toBuffer();
      if (file.file.truncated) {
        return reply.status(400).send({ error: 'Файл больше 10 МБ' });
      }

      // S3-хранилище (§15): ключ генерирует бэкенд, в БД пишется ключ объекта.
      // url для превью — ссылка на прокси API (как и постоянная обложка), а не
      // presigned-URL, чтобы превью сразу после загрузки не шло в Cloud.ru напрямую.
      if (fastify.storage) {
        const key = `projects/${randomUUID()}.${ext}`;
        await fastify.storage.putObject(key, buffer, file.mimetype);
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
