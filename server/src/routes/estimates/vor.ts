import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { requireRole } from '../../middleware/requireRole.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId } from '../../lib/estimate-detail.js';
import { exportEstimateKp, ExportError } from '../../lib/estimate-export/index.js';
import { createEstimateVorInputSchema, type VorFilterSnapshot } from '@estimat/shared';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Заголовок скачивания с кириллическим именем (attachment | inline).
function contentDisposition(kind: 'attachment' | 'inline', fileName: string): string {
  return `${kind}; filename="vor.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// Базовое имя → имя файла с ровно одним расширением .xlsx.
function toFileName(base: string): string {
  const trimmed = base.trim().replace(/\.xlsx$/i, '');
  return `${trimmed}.xlsx`;
}

// Разрешить набор id в подписи по справочнику (id → name); отсутствующие помечаем «(удалено)»,
// сохраняя порядок и сам id (для восстановления фильтра). Имя таблицы — из захардкоженного
// набора вызовов, не из пользовательского ввода.
async function resolveLabeled(
  pool: Pool,
  table: 'cost_categories' | 'cost_types' | 'project_zones' | 'project_location_types',
  ids: string[],
): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(`SELECT id, name FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
  const map = new Map<string, string>(rows.map((r) => [r.id as string, r.name as string]));
  return ids.map((id) => ({ id, name: map.get(id) ?? '(удалено)' }));
}

// Собрать исторический снимок фильтров (id + подписи) из машинных значений клиента.
async function buildFilterSnapshot(
  pool: Pool,
  filters: z.infer<typeof createEstimateVorInputSchema>['filters'],
): Promise<VorFilterSnapshot> {
  const [categories, types, zones, locationTypes] = await Promise.all([
    resolveLabeled(pool, 'cost_categories', filters.categoryIds),
    resolveLabeled(pool, 'cost_types', filters.typeIds),
    resolveLabeled(pool, 'project_zones', filters.zoneIds),
    resolveLabeled(pool, 'project_location_types', filters.locationTypeIds),
  ]);
  return {
    categories,
    types,
    zones,
    locationTypes,
    floorsText: filters.floorsText,
    volumeType: filters.volumeType,
    onlyUnreconciled: filters.onlyUnreconciled,
  };
}

// Стрим готового ВОР-файла из S3 (для скачивания/просмотра и идемпотентного повтора создания).
async function streamStoredFile(
  fastify: FastifyInstance,
  reply: FastifyReply,
  fileKey: string,
  fileName: string,
  kind: 'attachment' | 'inline',
): Promise<unknown> {
  if (!fastify.storage) return reply.status(503).send({ error: 'Хранилище файлов не настроено' });
  const obj = await fastify.storage.getObject(fileKey);
  reply.type(XLSX_MIME);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Disposition', contentDisposition(kind, fileName));
  return reply.send(obj.body);
}

// История именованных выгрузок ВОР по смете: создание (экспорт + сохранение), список, отметки
// строк, скачивание/просмотр файла, удаление. Все маршруты estimate-scoped, доступ — как у экспорта.
export function registerVorRoutes(fastify: FastifyInstance): void {
  const ROLES = ['admin', 'engineer', 'manager'] as const;

  // POST /:id/vors — создать ВОР = экспорт видимых строк + сохранение файла-снимка в S3.
  fastify.post<{ Params: { id: string } }>(
    '/:id/vors',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) return reply.status(400).send({ error: 'Некорректный id' });
      const estimateId = id.data;
      try {
        await assertEstimateAccess(fastify.pool, estimateId, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const parsed = createEstimateVorInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Некорректный запрос экспорта' });
      const body = parsed.data;

      if (!fastify.storage) return reply.status(503).send({ error: 'Хранилище файлов не настроено' });

      // Идемпотентность: повтор с тем же requestId возвращает уже созданный файл (без пересборки).
      const { rows: existing } = await fastify.pool.query(
        'SELECT file_key, file_name FROM estimate_vors WHERE estimate_id = $1 AND request_id = $2',
        [estimateId, body.requestId],
      );
      if (existing[0]) {
        return streamStoredFile(fastify, reply, existing[0].file_key, existing[0].file_name, 'attachment');
      }

      // Собрать .xlsx. Конфликт единиц (без ignoreUnitConflicts) → 409 ДО любых записей/загрузок.
      let buffer: Buffer;
      try {
        buffer = await exportEstimateKp(fastify.pool, estimateId, body.items, {
          ignoreUnitConflicts: body.ignoreUnitConflicts,
        });
      } catch (err) {
        if (err instanceof ExportError)
          return reply.status(err.status).send({ error: err.message, code: err.code, data: err.data });
        throw err;
      }

      const snapshot = await buildFilterSnapshot(fastify.pool, body.filters);
      const fileName = toFileName(body.name);
      const vorId = randomUUID();
      const fileKey = `estimate-vors/${estimateId}/${vorId}.xlsx`;
      const checksum = createHash('sha256').update(buffer).digest('hex');

      // Файл — до записи в БД; при ошибке БД компенсируем удалением объекта из S3.
      await fastify.storage.putObject(fileKey, buffer, XLSX_MIME);
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO estimate_vors
             (id, estimate_id, request_id, name, filters, file_key, file_name, file_size, mime_type,
              checksum, created_by, created_by_name)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)`,
          [
            vorId, estimateId, body.requestId, body.name, JSON.stringify(snapshot), fileKey, fileName,
            buffer.length, XLSX_MIME, checksum, request.currentUser.id, request.currentUser.fullName,
          ],
        );
        await client.query(
          `INSERT INTO estimate_vor_items (vor_id, item_id) SELECT $1::uuid, unnest($2::uuid[])`,
          [vorId, body.items.map((i) => i.id)],
        );
        const projectId = await loadProjectId(client, estimateId);
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'vor_created', estimateId, projectId, request.currentUser.id);
      } catch (err) {
        await client.query('ROLLBACK');
        // Компенсация: убрать осиротевший объект (best-effort).
        try {
          await fastify.storage.deleteObject(fileKey);
        } catch (delErr) {
          fastify.log.warn({ err: delErr, fileKey }, 'orphan cleanup after vor insert failure');
        }
        // Гонка одинакового requestId (unique violation) — вернуть ранее созданный файл.
        if ((err as { code?: string }).code === '23505') {
          const { rows } = await fastify.pool.query(
            'SELECT file_key, file_name FROM estimate_vors WHERE estimate_id = $1 AND request_id = $2',
            [estimateId, body.requestId],
          );
          if (rows[0]) return streamStoredFile(fastify, reply, rows[0].file_key, rows[0].file_name, 'attachment');
        }
        throw err;
      } finally {
        client.release();
      }

      // Отдаём те же байты под введённым именем (файл сразу скачивается).
      reply.type(XLSX_MIME);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Disposition', contentDisposition('attachment', fileName));
      return reply.send(buffer);
    },
  );

  // GET /:id/vors — список созданных ВОР сметы.
  fastify.get<{ Params: { id: string } }>(
    '/:id/vors',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) return reply.status(400).send({ error: 'Некорректный id' });
      try {
        await assertEstimateAccess(fastify.pool, id.data, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const { rows } = await fastify.pool.query(
        `SELECT id, name, file_name, filters, created_at, created_by, created_by_name
           FROM estimate_vors WHERE estimate_id = $1 ORDER BY created_at DESC`,
        [id.data],
      );
      const isAdmin = request.currentUser.role === 'admin';
      const data = rows.map((r) => ({
        id: r.id,
        name: r.name,
        fileName: r.file_name,
        filters: r.filters,
        createdAt: r.created_at,
        createdByName: r.created_by_name,
        canDelete: isAdmin || r.created_by === request.currentUser.id,
      }));
      return reply.send({ data });
    },
  );

  // GET /:id/vors/marks — компактные отметки строк: { itemId: [{id,name}] } (порядок created_at DESC).
  fastify.get<{ Params: { id: string } }>(
    '/:id/vors/marks',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) return reply.status(400).send({ error: 'Некорректный id' });
      try {
        await assertEstimateAccess(fastify.pool, id.data, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const { rows } = await fastify.pool.query(
        `SELECT vi.item_id, v.id AS vor_id, v.name
           FROM estimate_vor_items vi
           JOIN estimate_vors v ON v.id = vi.vor_id
          WHERE v.estimate_id = $1
          ORDER BY v.created_at DESC`,
        [id.data],
      );
      const marks: Record<string, { id: string; name: string }[]> = {};
      for (const r of rows) {
        (marks[r.item_id] ??= []).push({ id: r.vor_id, name: r.name });
      }
      return reply.send({ data: marks });
    },
  );

  // GET /:id/vors/:vorId/file?disposition=inline|attachment — прокси-скачивание/просмотр файла.
  fastify.get<{ Params: { id: string; vorId: string }; Querystring: { disposition?: string } }>(
    '/:id/vors/:vorId/file',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.id);
      const vorId = z.string().uuid().safeParse(request.params.vorId);
      if (!id.success || !vorId.success) return reply.status(400).send({ error: 'Некорректный id' });
      try {
        await assertEstimateAccess(fastify.pool, id.data, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const { rows } = await fastify.pool.query(
        'SELECT file_key, file_name FROM estimate_vors WHERE id = $1 AND estimate_id = $2',
        [vorId.data, id.data],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'ВОР не найден' });
      const kind = request.query.disposition === 'inline' ? 'inline' : 'attachment';
      return streamStoredFile(fastify, reply, rows[0].file_key, rows[0].file_name, kind);
    },
  );

  // DELETE /:id/vors/:vorId — удалить ВОР (запись + файл). Только автор или admin.
  fastify.delete<{ Params: { id: string; vorId: string } }>(
    '/:id/vors/:vorId',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.id);
      const vorId = z.string().uuid().safeParse(request.params.vorId);
      if (!id.success || !vorId.success) return reply.status(400).send({ error: 'Некорректный id' });
      try {
        await assertEstimateAccess(fastify.pool, id.data, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const { rows } = await fastify.pool.query(
        'SELECT created_by FROM estimate_vors WHERE id = $1 AND estimate_id = $2',
        [vorId.data, id.data],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'ВОР не найден' });
      const isAdmin = request.currentUser.role === 'admin';
      if (!isAdmin && rows[0].created_by !== request.currentUser.id) {
        return reply.status(403).send({ error: 'Удалять может только автор или администратор' });
      }
      // Сначала БД (vor_items снимутся каскадом), затем идемпотентная очистка S3.
      const { rows: del } = await fastify.pool.query(
        'DELETE FROM estimate_vors WHERE id = $1 AND estimate_id = $2 RETURNING file_key',
        [vorId.data, id.data],
      );
      if (del[0]?.file_key && fastify.storage) {
        try {
          await fastify.storage.deleteObject(del[0].file_key);
        } catch (delErr) {
          fastify.log.warn({ err: delErr, fileKey: del[0].file_key }, 'orphan cleanup after vor delete');
        }
      }
      const projectId = await loadProjectId(fastify.pool, id.data);
      await emitEstimateChanged(fastify, 'vor_deleted', id.data, projectId, request.currentUser.id);
      return reply.send({ data: { ok: true } });
    },
  );
}
