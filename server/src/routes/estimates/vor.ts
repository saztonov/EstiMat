import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { requireRole } from '../../middleware/requireRole.js';
import { assertEstimateAccess, ChatAccessError } from '../../lib/chat/access.js';
import { emitEstimateChanged } from '../../lib/realtime/emit.js';
import { loadProjectId } from '../../lib/estimate-detail.js';
import { buildContentFacets, exportEstimateKp, ExportError } from '../../lib/estimate-export/index.js';
import { gatherVorItemSnapshots } from '../../lib/estimate-export/data.js';
import { renderXlsxPreview } from '../../lib/estimate-export/xlsx-preview.js';
import {
  contentHash,
  diffItem,
  formatVorLocations,
  isSupportedSchemaVersion,
  type VorItemSnapshot,
  type VorManifest,
} from '../../lib/estimate-export/vor-content.js';
import {
  createEstimateVorInputSchema,
  type VorContentFacets,
  type VorCounts,
  type VorFilterSnapshot,
  type VorItemState,
  type VorMark,
} from '@estimat/shared';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GZIP_MIME = 'application/gzip';

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

// Прочитать объект S3 целиком в память (для gzip-manifest — маленький, не стримим).
async function readObjectBuffer(fastify: FastifyInstance, key: string): Promise<Buffer> {
  const obj = await fastify.storage!.getObject(key);
  const chunks: Buffer[] = [];
  for await (const c of obj.body as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

/** Метаданные снимка ВОР из БД (нужны и diff'у, и импорту цен, и фасетам реестра). */
export interface VorSnapshotMeta {
  snapshotKey: string | null;
  snapshotChecksum: Buffer | null;
  version: number;
}

/**
 * Построчный снимок ВОР из S3. null — снимка нет или он непригоден: легаси-ВОР (version 0),
 * неподдерживаемая версия схемы, отсутствующий/повреждённый объект. Вызывающий решает сам,
 * что это значит: для diff — «подробности недоступны», для импорта цен — отказ.
 */
export async function loadVorManifest(
  fastify: FastifyInstance,
  meta: VorSnapshotMeta,
): Promise<VorManifest | null> {
  const { snapshotKey, snapshotChecksum, version } = meta;
  if (!snapshotKey || version < 1 || !isSupportedSchemaVersion(version) || !fastify.storage) return null;
  try {
    const gz = await readObjectBuffer(fastify, snapshotKey);
    if (snapshotChecksum && !createHash('sha256').update(gz).digest().equals(snapshotChecksum)) return null;
    return JSON.parse(gunzipSync(gz).toString()) as VorManifest;
  } catch (err) {
    fastify.log.warn({ err, snapshotKey }, 'vor manifest read/parse failed');
    return null;
  }
}

export interface VorItemStateRow {
  itemId: string;
  vorId: string;
  name: string;
  createdAt: string;
  state: VorItemState;
}

// Рассчитать статус каждой пары (ВОР, строка) сметы: сравнить построчный baseline-хэш с хэшем
// текущего состояния строки. Один сбор текущего состояния на все уникальные живые строки ВОР.
export async function loadVorItemStates(
  fastify: FastifyInstance,
  estimateId: string,
): Promise<VorItemStateRow[]> {
  const { rows } = await fastify.pool.query(
    `SELECT vi.item_id, vi.content_hash, v.id AS vor_id, v.name, v.created_at, v.content_schema_version
       FROM estimate_vor_items vi
       JOIN estimate_vors v ON v.id = vi.vor_id
      WHERE v.estimate_id = $1
      ORDER BY v.created_at DESC`,
    [estimateId],
  );
  // Текущее состояние собираем только для строк с отслеживаемой версией (легаси version=0 → unknown
  // без сборки). Отсутствие строки в снимке = удалена (deleted).
  const liveIds = [
    ...new Set(rows.filter((r) => (r.content_schema_version as number) >= 1).map((r) => r.item_id as string)),
  ];
  const curSnap = await gatherVorItemSnapshots(fastify.pool, estimateId, liveIds);
  const hashCache = new Map<string, Buffer>();
  const curHash = (itemId: string, version: number): Buffer => {
    const key = `${itemId}:${version}`;
    let h = hashCache.get(key);
    if (!h) {
      h = contentHash(curSnap.get(itemId) as VorItemSnapshot, version);
      hashCache.set(key, h);
    }
    return h;
  };
  return rows.map((r) => {
    const version = r.content_schema_version as number;
    let state: VorItemState;
    if (version === 0 || !isSupportedSchemaVersion(version)) state = 'unknown';
    else if (!curSnap.has(r.item_id as string)) state = 'deleted';
    else {
      const baseline = r.content_hash as Buffer | null;
      state = baseline
        ? baseline.equals(curHash(r.item_id as string, version))
          ? 'unchanged'
          : 'changed'
        : 'unknown';
    }
    return {
      itemId: r.item_id as string,
      vorId: r.vor_id as string,
      name: r.name as string,
      createdAt: (r.created_at as Date).toISOString(),
      state,
    };
  });
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

      // id ВОР — ДО сборки книги: он уходит в служебный лист-якорь файла, по которому потом
      // распознаётся заполненный подрядчиком ВОР при загрузке договорных цен.
      const vorId = randomUUID();

      // Собрать .xlsx + построчный снимок (manifest) + хэши. Конфликт единиц (без
      // ignoreUnitConflicts) → 409 ДО любых записей/загрузок.
      let buffer: Buffer;
      let manifest: VorManifest;
      let hashByItem: Map<string, Buffer>;
      let facets: VorContentFacets;
      try {
        ({ buffer, manifest, hashByItem, facets } = await exportEstimateKp(
          fastify.pool,
          estimateId,
          body.items,
          { ignoreUnitConflicts: body.ignoreUnitConflicts, vorId },
        ));
      } catch (err) {
        if (err instanceof ExportError)
          return reply.status(err.status).send({ error: err.message, code: err.code, data: err.data });
        throw err;
      }

      const snapshot = await buildFilterSnapshot(fastify.pool, body.filters);
      const fileName = toFileName(body.name);
      const fileKey = `estimate-vors/${estimateId}/${vorId}.xlsx`;
      const snapshotKey = `estimate-vors/${estimateId}/${vorId}.snapshot.json.gz`;
      const checksum = createHash('sha256').update(buffer).digest('hex');
      // gzip-manifest снимка строк: точный источник для diff «было → стало».
      const manifestGz = gzipSync(Buffer.from(JSON.stringify(manifest)));
      const snapshotChecksum = createHash('sha256').update(manifestGz).digest();

      // Оба объекта — до записи в БД; при ошибке компенсируем удалением обоих из S3.
      await fastify.storage.putObject(fileKey, buffer, XLSX_MIME);
      await fastify.storage.putObject(snapshotKey, manifestGz, GZIP_MIME);
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO estimate_vors
             (id, estimate_id, request_id, name, filters, file_key, file_name, file_size, mime_type,
              checksum, created_by, created_by_name,
              content_schema_version, snapshot_key, snapshot_checksum, snapshot_size, content_facets)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
          [
            vorId, estimateId, body.requestId, body.name, JSON.stringify(snapshot), fileKey, fileName,
            buffer.length, XLSX_MIME, checksum, request.currentUser.id, request.currentUser.fullName,
            manifest.schemaVersion, snapshotKey, snapshotChecksum, manifestGz.length,
            JSON.stringify(facets),
          ],
        );
        // content_hash передаём как hex-строки + decode() — node-pg ненадёжно сериализует bytea[].
        await client.query(
          `INSERT INTO estimate_vor_items (vor_id, item_id, content_hash)
           SELECT $1::uuid, t.item_id, decode(t.h, 'hex')
             FROM unnest($2::uuid[], $3::text[]) AS t(item_id, h)`,
          [
            vorId,
            body.items.map((i) => i.id),
            body.items.map((i) => hashByItem.get(i.id)?.toString('hex') ?? null),
          ],
        );
        const projectId = await loadProjectId(client, estimateId);
        await client.query('COMMIT');
        await emitEstimateChanged(fastify, 'vor_created', estimateId, projectId, request.currentUser.id);
      } catch (err) {
        await client.query('ROLLBACK');
        // Компенсация: убрать оба осиротевших объекта (best-effort).
        for (const key of [fileKey, snapshotKey]) {
          try {
            await fastify.storage.deleteObject(key);
          } catch (delErr) {
            fastify.log.warn({ err: delErr, fileKey: key }, 'orphan cleanup after vor insert failure');
          }
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
        `SELECT id, name, file_name, filters, created_at, created_by, created_by_name,
                content_schema_version, snapshot_key, snapshot_checksum, content_facets
           FROM estimate_vors WHERE estimate_id = $1 ORDER BY created_at DESC`,
        [id.data],
      );
      // Фасеты (местоположения/типы строк ВОР) пишутся при создании; у ВОР, созданных раньше,
      // их нет — досчитываем из снимка при первом показе реестра и сохраняем, чтобы следующий
      // раз обошёлся без похода в S3.
      const facetsByVor = new Map<string, VorContentFacets>();
      for (const r of rows) {
        const stored = r.content_facets as VorContentFacets | null;
        if (stored) {
          facetsByVor.set(r.id as string, stored);
          continue;
        }
        const manifest = await loadVorManifest(fastify, {
          snapshotKey: r.snapshot_key as string | null,
          snapshotChecksum: r.snapshot_checksum as Buffer | null,
          version: r.content_schema_version as number,
        });
        if (!manifest) continue; // легаси-ВОР без снимка: фасетов взять неоткуда
        const facets = buildContentFacets(manifest);
        facetsByVor.set(r.id as string, facets);
        await fastify.pool.query(
          'UPDATE estimate_vors SET content_facets = $2::jsonb WHERE id = $1 AND content_facets IS NULL',
          [r.id, JSON.stringify(facets)],
        );
      }
      // Счётчики актуальности по каждому ВОР (изменено/удалено/неизвестно из построчных статусов).
      const states = await loadVorItemStates(fastify, id.data);
      const countsByVor = new Map<string, VorCounts>();
      for (const s of states) {
        const c = countsByVor.get(s.vorId) ?? { total: 0, changed: 0, deleted: 0, unknown: 0 };
        c.total += 1;
        if (s.state === 'changed') c.changed += 1;
        else if (s.state === 'deleted') c.deleted += 1;
        else if (s.state === 'unknown') c.unknown += 1;
        countsByVor.set(s.vorId, c);
      }
      const emptyCounts: VorCounts = { total: 0, changed: 0, deleted: 0, unknown: 0 };
      const isAdmin = request.currentUser.role === 'admin';
      const data = rows.map((r) => ({
        id: r.id,
        name: r.name,
        fileName: r.file_name,
        filters: r.filters,
        createdAt: r.created_at,
        createdByName: r.created_by_name,
        canDelete: isAdmin || r.created_by === request.currentUser.id,
        diffAvailable: !!r.snapshot_key && (r.content_schema_version as number) >= 1,
        counts: countsByVor.get(r.id as string) ?? emptyCounts,
        facets: facetsByVor.get(r.id as string) ?? { locations: [], types: [] },
      }));
      return reply.send({ data });
    },
  );

  // GET /:id/vors/marks — агрегатные отметки строк: { itemId: { state, vorCount, changedCount,
  // unknownCount } }. Строки, удалённые из сметы (deleted), в отметках не участвуют — их нет в
  // таблице сметы; они видны только в списке ВОР.
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
      const states = await loadVorItemStates(fastify, id.data);
      // states уже в порядке created_at DESC — список vors наследует его.
      const agg = new Map<
        string,
        { vorCount: number; changed: number; unknown: number; vors: { name: string; state: VorItemState }[] }
      >();
      for (const s of states) {
        if (s.state === 'deleted') continue;
        const a = agg.get(s.itemId) ?? { vorCount: 0, changed: 0, unknown: 0, vors: [] };
        a.vorCount += 1;
        if (s.state === 'changed') a.changed += 1;
        else if (s.state === 'unknown') a.unknown += 1;
        a.vors.push({ name: s.name, state: s.state });
        agg.set(s.itemId, a);
      }
      const marks: Record<string, VorMark> = {};
      for (const [itemId, a] of agg) {
        const state: VorItemState = a.changed > 0 ? 'changed' : a.unknown > 0 ? 'unknown' : 'unchanged';
        marks[itemId] = {
          state,
          vorCount: a.vorCount,
          changedCount: a.changed,
          unknownCount: a.unknown,
          vors: a.vors,
        };
      }
      return reply.send({ data: marks });
    },
  );

  // GET /:id/vors/items/:itemId — ленивая детализация: статус строки относительно каждого ВОР,
  // куда она входит (для popover по клику на метку «В»).
  fastify.get<{ Params: { id: string; itemId: string } }>(
    '/:id/vors/items/:itemId',
    { preHandler: [requireRole(...ROLES)] },
    async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.id);
      const itemId = z.string().uuid().safeParse(request.params.itemId);
      if (!id.success || !itemId.success) return reply.status(400).send({ error: 'Некорректный id' });
      try {
        await assertEstimateAccess(fastify.pool, id.data, request.currentUser);
      } catch (err) {
        if (err instanceof ChatAccessError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      const states = await loadVorItemStates(fastify, id.data);
      const data = states
        .filter((s) => s.itemId === itemId.data)
        .map((s) => ({ vorId: s.vorId, name: s.name, createdAt: s.createdAt, state: s.state }));
      return reply.send({ data });
    },
  );

  // GET /:id/vors/:vorId/diff — точный diff «было в ВОР → стало сейчас» по построчному снимку
  // (manifest из S3). Параметры: itemId (одна строка), onlyChanged, limit/offset (пагинация работ).
  fastify.get<{
    Params: { id: string; vorId: string };
    Querystring: { itemId?: string; onlyChanged?: string; limit?: string; offset?: string };
  }>(
    '/:id/vors/:vorId/diff',
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
        `SELECT snapshot_key, snapshot_checksum, content_schema_version
           FROM estimate_vors WHERE id = $1 AND estimate_id = $2`,
        [vorId.data, id.data],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'ВОР не найден' });
      // Прочитать и проверить manifest. Отсутствие/повреждение/неподдерживаемая версия → статусы
      // из построчных хэшей, но подробности «было → стало» недоступны (manifestOk=false).
      const manifest = await loadVorManifest(fastify, {
        snapshotKey: rows[0].snapshot_key as string | null,
        snapshotChecksum: rows[0].snapshot_checksum as Buffer | null,
        version: rows[0].content_schema_version as number,
      });
      const manifestOk = manifest !== null;
      const baseItems: VorItemSnapshot[] = manifest?.items ?? [];
      // Схема содержимого ЭТОГО ВОР — по ней diff решает, сравнивать ли состав работы: в снимках
      // v1 состава нет, и сравнение дало бы ложное «состав добавлен» у каждой строки.
      const vorSchemaVersion = rows[0].content_schema_version as number;

      if (!manifestOk) {
        // Подробностей нет — отдаём только счётчики по построчным хэшам.
        const states = (await loadVorItemStates(fastify, id.data)).filter((s) => s.vorId === vorId.data);
        const counts: VorCounts = { total: states.length, changed: 0, deleted: 0, unknown: 0 };
        for (const s of states) {
          if (s.state === 'changed') counts.changed += 1;
          else if (s.state === 'deleted') counts.deleted += 1;
          else if (s.state === 'unknown') counts.unknown += 1;
        }
        return reply.send({ data: { vorId: vorId.data, manifestOk: false, counts, items: [] } });
      }

      // Текущее состояние строк ВОР + имена зон (для читаемой метки локации в обеих сторонах diff).
      const itemIds = baseItems.map((b) => b.itemId);
      const curSnap = await gatherVorItemSnapshots(fastify.pool, id.data, itemIds);
      const zoneIds = new Set<string>();
      for (const it of [...baseItems, ...curSnap.values()])
        for (const l of it.locations) if (l.zoneId) zoneIds.add(l.zoneId);
      const zoneNameById = new Map<string, string>();
      if (zoneIds.size) {
        const zr = await fastify.pool.query('SELECT id, name FROM project_zones WHERE id = ANY($1::uuid[])', [
          [...zoneIds],
        ]);
        for (const z of zr.rows) zoneNameById.set(z.id as string, z.name as string);
      }

      const counts: VorCounts = { total: baseItems.length, changed: 0, deleted: 0, unknown: 0 };
      const diffs = baseItems.map((b) => {
        const before = { ...b, locationLabel: formatVorLocations(b.locations, zoneNameById) };
        const cur = curSnap.get(b.itemId);
        const after = cur ? { ...cur, locationLabel: formatVorLocations(cur.locations, zoneNameById) } : null;
        const d = diffItem(before, after, vorSchemaVersion);
        if (d.state === 'changed') counts.changed += 1;
        else if (d.state === 'deleted') counts.deleted += 1;
        return d;
      });

      let items = diffs;
      if (request.query.itemId) items = items.filter((d) => d.itemId === request.query.itemId);
      if (request.query.onlyChanged === 'true') items = items.filter((d) => d.state !== 'unchanged');
      const offset = Math.max(0, Number(request.query.offset) || 0);
      const limitRaw = Number(request.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : items.length;
      items = items.slice(offset, offset + limit);

      return reply.send({ data: { vorId: vorId.data, manifestOk: true, counts, items } });
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

  // GET /:id/vors/:vorId/preview — styled HTML-предпросмотр листов файла (форматирование как в Excel):
  // читаем xlsx из S3 тем же ExcelJS, что его генерировал, и отдаём HTML с инлайн-стилями.
  fastify.get<{ Params: { id: string; vorId: string } }>(
    '/:id/vors/:vorId/preview',
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
      if (!fastify.storage) return reply.status(503).send({ error: 'Хранилище файлов не настроено' });
      const { rows } = await fastify.pool.query(
        'SELECT file_key FROM estimate_vors WHERE id = $1 AND estimate_id = $2',
        [vorId.data, id.data],
      );
      if (!rows[0]) return reply.status(404).send({ error: 'ВОР не найден' });
      const buffer = await readObjectBuffer(fastify, rows[0].file_key as string);
      const sheets = await renderXlsxPreview(buffer);
      return reply.send({ data: { sheets } });
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
      // Сначала БД (vor_items снимутся каскадом), затем идемпотентная очистка S3 (файл + manifest).
      const { rows: del } = await fastify.pool.query(
        'DELETE FROM estimate_vors WHERE id = $1 AND estimate_id = $2 RETURNING file_key, snapshot_key',
        [vorId.data, id.data],
      );
      if (fastify.storage) {
        for (const key of [del[0]?.file_key, del[0]?.snapshot_key]) {
          if (!key) continue;
          try {
            await fastify.storage.deleteObject(key);
          } catch (delErr) {
            fastify.log.warn({ err: delErr, fileKey: key }, 'orphan cleanup after vor delete');
          }
        }
      }
      const projectId = await loadProjectId(fastify.pool, id.data);
      await emitEstimateChanged(fastify, 'vor_deleted', id.data, projectId, request.currentUser.id);
      return reply.send({ data: { ok: true } });
    },
  );
}
