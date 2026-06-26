import type { FastifyInstance } from 'fastify';
import { unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { withImageSrc, isLegacyLocalImage } from '../../lib/projectImage.js';
import {
  createProjectSchema,
  updateProjectSchema,
  createZoneSchema,
  updateZoneSchema,
  bulkZonesSchema,
  setProjectRoomTypesSchema,
} from '@estimat/shared';

interface ZoneRow {
  id: string;
  parent_id: string | null;
  [key: string]: unknown;
}
interface ZoneNode extends ZoneRow {
  children: ZoneNode[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
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
// deleteObject (идемпотентно, §15).
async function removeUpload(fastify: FastifyInstance, value: string | null | undefined) {
  if (!value) return;
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
  if (fastify.storage) await fastify.storage.deleteObject(value);
}

// Полная детализация сметы (как в GET /estimates/:id): работы с измерениями,
// материалы (вложенно), подрядчики по видам работ. Возвращает null, если нет.
async function buildEstimateDetail(fastify: FastifyInstance, estimateId: string) {
  const { rows } = await fastify.pool.query(
    `SELECT e.*, p.code AS project_code, p.name AS project_name, cc.name AS cost_category_name
       FROM estimates e
       JOIN projects p ON e.project_id = p.id
       LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
      WHERE e.id = $1`,
    [estimateId],
  );
  if (rows.length === 0) return null;

  const items = await fastify.pool.query(
    `SELECT ei.*, r.name AS rate_name, r.code AS rate_code,
            ct.name AS cost_type_name, cc.name AS cost_category_name,
            z.name AS zone_name, z.kind AS zone_kind, rt.name AS room_type_name,
            lt.name AS location_type_name
       FROM estimate_items ei
       LEFT JOIN rates r            ON ei.rate_id = r.id
       LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
       LEFT JOIN project_zones z    ON ei.zone_id = z.id
       LEFT JOIN room_types rt      ON ei.room_type_id = rt.id
       LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
      WHERE ei.estimate_id = $1
      ORDER BY z.sort_order NULLS LAST, ei.floor_from NULLS LAST, rt.sort_order NULLS LAST,
               cc.sort_order, ct.sort_order, ei.sort_order, ei.created_at`,
    [estimateId],
  );

  const materials = await fastify.pool.query(
    `SELECT em.*, mc.name AS material_name
       FROM estimate_materials em
       LEFT JOIN material_catalog mc ON em.material_id = mc.id
      WHERE em.estimate_id = $1
      ORDER BY em.sort_order, em.created_at`,
    [estimateId],
  );

  const contractors = await fastify.pool.query(
    `SELECT ec.cost_type_id, ec.contractor_id,
            o.name AS contractor_name, ct.name AS cost_type_name,
            cc.id AS cost_category_id, cc.name AS cost_category_name
       FROM estimate_contractors ec
       LEFT JOIN organizations o    ON ec.contractor_id = o.id
       LEFT JOIN cost_types ct      ON ec.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ct.category_id = cc.id
      WHERE ec.estimate_id = $1`,
    [estimateId],
  );

  return {
    ...rows[0],
    items: items.rows.map((it) => ({
      ...it,
      materials: materials.rows.filter((m) => m.item_id === it.id),
    })),
    contractors: contractors.rows,
  };
}

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/projects
  // Объекты/сметы закрыты для contractor — он работает только в разделе «Подрядчики».
  fastify.get('/', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async () => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM projects ORDER BY code',
    );
    return { data: rows.map((r) => withImageSrc(fastify, r)) };
  });

  // GET /api/projects/with-stats — для галереи объектов на странице «Сметы»
  fastify.get('/with-stats', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async () => {
    const { rows } = await fastify.pool.query(
      `SELECT p.*,
              COALESCE(COUNT(e.id), 0)::int AS estimates_count,
              COALESCE(SUM(e.total_amount), 0)::numeric AS estimates_total
         FROM projects p
         LEFT JOIN estimates e ON e.project_id = p.id
         GROUP BY p.id
         ORDER BY p.code`,
    );
    return { data: rows.map((r) => withImageSrc(fastify, r)) };
  });

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

  // GET /api/projects/:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const { rows } = await fastify.pool.query(
        'SELECT * FROM projects WHERE id = $1',
        [request.params.id],
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });
      return { data: withImageSrc(fastify, rows[0]) };
    },
  );

  // GET /api/projects/:id/summary — сводная смета по объекту
  fastify.get<{ Params: { id: string } }>(
    '/:id/summary',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
    const { rows: projectRows } = await fastify.pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [request.params.id],
    );
    if (projectRows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });

    const { rows: estimates } = await fastify.pool.query(
      `SELECT e.id, e.work_type, e.status, e.total_amount, e.created_at,
              e.cost_category_id,
              cc.name AS cost_category_name
         FROM estimates e
         LEFT JOIN cost_categories cc ON e.cost_category_id = cc.id
         WHERE e.project_id = $1
         ORDER BY e.created_at DESC`,
      [request.params.id],
    );

    const estimateIds = estimates.map((e) => e.id);

    const itemsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT ei.*,
                    r.name  AS rate_name,
                    r.code  AS rate_code,
                    ct.name AS cost_type_name,
                    cc.name AS cost_category_name,
                    z.name  AS zone_name,
                    z.kind  AS zone_kind,
                    rt.name AS room_type_name,
                    lt.name AS location_type_name
               FROM estimate_items ei
               LEFT JOIN rates r            ON ei.rate_id = r.id
               LEFT JOIN cost_types ct      ON ei.cost_type_id = ct.id
               LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
               LEFT JOIN project_zones z    ON ei.zone_id = z.id
               LEFT JOIN room_types rt      ON ei.room_type_id = rt.id
               LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
               WHERE ei.estimate_id = ANY($1)
               ORDER BY z.sort_order NULLS LAST, ei.floor_from NULLS LAST, rt.sort_order NULLS LAST,
                        cc.sort_order, ct.sort_order, ei.sort_order, ei.created_at`,
            [estimateIds],
          )
        ).rows
      : [];

    const materialsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT em.*, mc.name AS material_name
               FROM estimate_materials em
               LEFT JOIN material_catalog mc ON em.material_id = mc.id
               WHERE em.estimate_id = ANY($1)
               ORDER BY em.sort_order, em.created_at`,
            [estimateIds],
          )
        ).rows
      : [];

    const contractorsRows = estimateIds.length
      ? (
          await fastify.pool.query(
            `SELECT ec.estimate_id, ec.cost_type_id, ec.contractor_id,
                    o.name  AS contractor_name,
                    ct.name AS cost_type_name,
                    cc.id   AS cost_category_id,
                    cc.name AS cost_category_name
               FROM estimate_contractors ec
               LEFT JOIN organizations o    ON ec.contractor_id = o.id
               LEFT JOIN cost_types ct      ON ec.cost_type_id = ct.id
               LEFT JOIN cost_categories cc ON ct.category_id = cc.id
               WHERE ec.estimate_id = ANY($1)`,
            [estimateIds],
          )
        ).rows
      : [];

    const itemsWithMaterials = itemsRows.map((it) => ({
      ...it,
      materials: materialsRows.filter((m) => m.item_id === it.id),
    }));

    const estimatesWithItems = estimates.map((e) => ({
      ...e,
      items: itemsWithMaterials.filter((it) => it.estimate_id === e.id),
      contractors: contractorsRows.filter((c) => c.estimate_id === e.id),
    }));

    const grandTotal = estimates.reduce((acc, e) => acc + Number(e.total_amount || 0), 0);

    return {
      data: {
        project: withImageSrc(fastify, projectRows[0]),
        estimates: estimatesWithItems,
        grandTotal,
      },
    };
  });

  // GET /api/projects/:id/estimate — единая смета на объект.
  // get-or-create: если смет нет — создаём одну; если несколько — сливаем
  // позиции/материалы/подрядчиков в самую раннюю (primary), пустые удаляем.
  fastify.get<{ Params: { id: string } }>(
    '/:id/estimate',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const projectId = request.params.id;
      const { rows: projectRows } = await fastify.pool.query(
        'SELECT id FROM projects WHERE id = $1',
        [projectId],
      );
      if (projectRows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });

      const client = await fastify.pool.connect();
      let primaryId: string;
      try {
        await client.query('BEGIN');
        const { rows: ests } = await client.query(
          'SELECT id FROM estimates WHERE project_id = $1 ORDER BY created_at ASC',
          [projectId],
        );
        if (ests.length === 0) {
          const ins = await client.query(
            'INSERT INTO estimates (project_id, created_by) VALUES ($1, $2) RETURNING id',
            [projectId, request.currentUser.id],
          );
          primaryId = ins.rows[0].id as string;
        } else {
          primaryId = ests[0].id as string;
          if (ests.length > 1) {
            const others = ests.slice(1).map((e) => e.id as string);
            await client.query('UPDATE estimate_items SET estimate_id = $1 WHERE estimate_id = ANY($2)', [primaryId, others]);
            await client.query('UPDATE estimate_materials SET estimate_id = $1 WHERE estimate_id = ANY($2)', [primaryId, others]);
            await client.query(
              `INSERT INTO estimate_contractors (estimate_id, cost_type_id, contractor_id)
               SELECT $1, cost_type_id, contractor_id FROM estimate_contractors WHERE estimate_id = ANY($2)
               ON CONFLICT (estimate_id, cost_type_id) DO NOTHING`,
              [primaryId, others],
            );
            await client.query('DELETE FROM estimates WHERE id = ANY($1)', [others]);
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      const data = await buildEstimateDetail(fastify, primaryId);
      return { data };
    },
  );

  // POST /api/projects
  fastify.post('/', { preHandler: [requireRole('admin', 'manager')] }, async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO projects (code, name, full_name, address, status, start_date, end_date, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        body.code,
        body.name,
        body.fullName || null,
        body.address || null,
        body.status,
        body.startDate || null,
        body.endDate || null,
        body.imageUrl || null,
      ],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/projects/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'manager')] }, async (request, reply) => {
    const body = updateProjectSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.code !== undefined) { sets.push(`code = $${i++}`); values.push(body.code); }
    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.fullName !== undefined) { sets.push(`full_name = $${i++}`); values.push(body.fullName); }
    if (body.address !== undefined) { sets.push(`address = $${i++}`); values.push(body.address); }
    if (body.status !== undefined) { sets.push(`status = $${i++}`); values.push(body.status); }
    if (body.startDate !== undefined) { sets.push(`start_date = $${i++}`); values.push(body.startDate); }
    if (body.endDate !== undefined) { sets.push(`end_date = $${i++}`); values.push(body.endDate); }
    if (body.imageUrl !== undefined) { sets.push(`image_url = $${i++}`); values.push(body.imageUrl); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    let previousImageUrl: string | null = null;
    if (body.imageUrl !== undefined) {
      const { rows: prev } = await fastify.pool.query(
        'SELECT image_url FROM projects WHERE id = $1',
        [request.params.id],
      );
      previousImageUrl = prev[0]?.image_url ?? null;
    }

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Проект не найден' });

    if (body.imageUrl !== undefined && previousImageUrl && previousImageUrl !== body.imageUrl) {
      await removeUpload(fastify, previousImageUrl);
    }

    return { data: withImageSrc(fastify, rows[0]) };
  });

  // GET /api/projects/:id/members
  fastify.get<{ Params: { id: string } }>('/:id/members', async (request) => {
    const { rows } = await fastify.pool.query(
      `SELECT pm.*, u.email, u.full_name
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [request.params.id],
    );
    return { data: rows };
  });

  // POST /api/projects/:id/members
  fastify.post<{ Params: { id: string } }>('/:id/members', { preHandler: [requireRole('admin', 'manager')] }, async (request, reply) => {
    const { userId, role } = request.body as { userId: string; role: string };
    const { rows } = await fastify.pool.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3) RETURNING *`,
      [request.params.id, userId, role],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // ============================================================
  // Локации объекта: зоны (география) + активные типы помещений
  // ============================================================

  // GET /api/projects/:id/zones — дерево зон объекта (корпус/парковка/стилобат/секция)
  fastify.get<{ Params: { id: string } }>('/:id/zones', async (request) => {
    // «Улица» есть всегда: lazy-seed, если её ещё нет у объекта (идемпотентно).
    await fastify.pool.query(
      `INSERT INTO project_zones (project_id, name, kind, sort_order)
       SELECT $1, 'Улица', 'street', 5
        WHERE NOT EXISTS (SELECT 1 FROM project_zones WHERE project_id = $1 AND kind = 'street')`,
      [request.params.id],
    );
    const { rows } = await fastify.pool.query<ZoneRow>(
      'SELECT * FROM project_zones WHERE project_id = $1 ORDER BY sort_order, name',
      [request.params.id],
    );
    // Построение дерева из parent_id в памяти (паттерн materials.get('/tree')).
    const byId = new Map<string, ZoneNode>();
    for (const z of rows) byId.set(z.id, { ...z, children: [] });
    const roots: ZoneNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return { data: { roots } };
  });

  // GET /api/projects/:id/location-types — произвольные «типы» строк объекта (для автодополнения
  // в поповере локации). Опциональный ?search= фильтрует по подстроке (без учёта регистра).
  fastify.get<{ Params: { id: string }; Querystring: { search?: string } }>(
    '/:id/location-types',
    async (request) => {
      const search = (request.query.search ?? '').trim().toLowerCase();
      const values: unknown[] = [request.params.id];
      let where = 'project_id = $1';
      if (search) {
        values.push(`%${search}%`);
        where += ` AND name_norm LIKE $${values.length}`;
      }
      const { rows } = await fastify.pool.query(
        `SELECT id, name FROM project_location_types WHERE ${where} ORDER BY sort_order, name LIMIT 50`,
        values,
      );
      return { data: rows };
    },
  );

  // POST /api/projects/:id/zones
  fastify.post<{ Params: { id: string } }>(
    '/:id/zones',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const body = createZoneSchema.parse(request.body);
      const { rows } = await fastify.pool.query(
        `INSERT INTO project_zones
           (project_id, parent_id, name, kind, code, floor_min, floor_max, sort_order, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *`,
        [
          request.params.id,
          body.parentId ?? null,
          body.name,
          body.kind,
          body.code ?? null,
          body.floorMin ?? null,
          body.floorMax ?? null,
          body.sortOrder ?? 0,
          request.currentUser.id,
        ],
      );
      return reply.status(201).send({ data: rows[0] });
    },
  );

  // PUT /api/projects/:id/zones/bulk — пакетное сохранение конструктора локаций.
  // Регистрируется ДО параметризованного '/:id/zones/:zoneId' (явный приоритет статического сегмента).
  // upsert переданных зон + удаление только перечисленных deletedIds; зоны вне обоих списков не трогаем.
  fastify.put<{ Params: { id: string } }>(
    '/:id/zones/bulk',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const { zones, deletedIds } = bulkZonesSchema.parse(request.body);
      const projectId = request.params.id;
      const userId = request.currentUser.id;

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');

        if (deletedIds.length > 0) {
          // WHERE по project_id гарантирует, что чужой объект не затронуть.
          await client.query(
            'DELETE FROM project_zones WHERE project_id = $1 AND id = ANY($2::uuid[])',
            [projectId, deletedIds],
          );
        }

        // Родители (parent_id = null) — раньше детей, чтобы FK на parent_id не падал в одной транзакции.
        const ordered = [...zones].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
        for (const z of ordered) {
          if (z.id) {
            // upsert по id (клиент генерирует uuid для новых — ссылки parent_id/spans стабильны).
            // ON CONFLICT ... WHERE project_id совпадает: чужой объект (тот же id) не перезаписать.
            await client.query(
              `INSERT INTO project_zones
                 (id, project_id, parent_id, name, kind, code, floor_min, floor_max, sort_order, spans_zone_ids, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid[], $11, $11)
               ON CONFLICT (id) DO UPDATE SET
                 parent_id = EXCLUDED.parent_id, name = EXCLUDED.name, kind = EXCLUDED.kind,
                 code = EXCLUDED.code, floor_min = EXCLUDED.floor_min, floor_max = EXCLUDED.floor_max,
                 sort_order = EXCLUDED.sort_order, spans_zone_ids = EXCLUDED.spans_zone_ids,
                 updated_by = EXCLUDED.updated_by
               WHERE project_zones.project_id = EXCLUDED.project_id`,
              [
                z.id, projectId, z.parentId ?? null, z.name, z.kind, z.code ?? null,
                z.floorMin ?? null, z.floorMax ?? null, z.sortOrder ?? 0, z.spansZoneIds ?? [], userId,
              ],
            );
          } else {
            await client.query(
              `INSERT INTO project_zones
                 (project_id, parent_id, name, kind, code, floor_min, floor_max, sort_order, spans_zone_ids, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10, $10)`,
              [
                projectId, z.parentId ?? null, z.name, z.kind, z.code ?? null,
                z.floorMin ?? null, z.floorMax ?? null, z.sortOrder ?? 0, z.spansZoneIds ?? [], userId,
              ],
            );
          }
        }

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      // Этажность зон могла измениться — строки сметы могут оказаться вне диапазона.
      const { rows } = await fastify.pool.query<ZoneRow>(
        'SELECT * FROM project_zones WHERE project_id = $1 ORDER BY sort_order, name',
        [projectId],
      );
      const byId = new Map<string, ZoneNode>();
      for (const z of rows) byId.set(z.id, { ...z, children: [] });
      const roots: ZoneNode[] = [];
      for (const node of byId.values()) {
        const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      return reply.send({ data: { roots } });
    },
  );

  // PUT /api/projects/:id/zones/:zoneId
  fastify.put<{ Params: { id: string; zoneId: string } }>(
    '/:id/zones/:zoneId',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const body = updateZoneSchema.parse(request.body);
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if (body.parentId !== undefined) { sets.push(`parent_id = $${i++}`); values.push(body.parentId); }
      if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
      if (body.kind !== undefined) { sets.push(`kind = $${i++}`); values.push(body.kind); }
      if (body.code !== undefined) { sets.push(`code = $${i++}`); values.push(body.code); }
      if (body.floorMin !== undefined) { sets.push(`floor_min = $${i++}`); values.push(body.floorMin); }
      if (body.floorMax !== undefined) { sets.push(`floor_max = $${i++}`); values.push(body.floorMax); }
      if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); values.push(body.sortOrder); }

      if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });
      sets.push(`updated_by = $${i++}`); values.push(request.currentUser.id);

      values.push(request.params.zoneId);
      values.push(request.params.id);
      const { rows } = await fastify.pool.query(
        `UPDATE project_zones SET ${sets.join(', ')} WHERE id = $${i++} AND project_id = $${i} RETURNING *`,
        values,
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Зона не найдена' });
      return { data: rows[0] };
    },
  );

  // DELETE /api/projects/:id/zones/:zoneId — FK SET NULL обнулит zone_id у строк сметы
  fastify.delete<{ Params: { id: string; zoneId: string } }>(
    '/:id/zones/:zoneId',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const { rowCount } = await fastify.pool.query(
        'DELETE FROM project_zones WHERE id = $1 AND project_id = $2',
        [request.params.zoneId, request.params.id],
      );
      if (rowCount === 0) return reply.status(404).send({ error: 'Зона не найдена' });
      return { success: true };
    },
  );

  // GET /api/projects/:id/room-types — активные типы помещений объекта
  // (фолбэк на все is_active, если junction для объекта пуст).
  fastify.get<{ Params: { id: string } }>('/:id/room-types', async (request) => {
    const { rows } = await fastify.pool.query(
      `SELECT rt.*
         FROM project_room_types prt
         JOIN room_types rt ON rt.id = prt.room_type_id
        WHERE prt.project_id = $1
        ORDER BY prt.sort_order, rt.sort_order, rt.name`,
      [request.params.id],
    );
    if (rows.length > 0) return { data: rows };
    const fallback = await fastify.pool.query(
      'SELECT * FROM room_types WHERE is_active = true ORDER BY sort_order, name',
    );
    return { data: fallback.rows };
  });

  // PUT /api/projects/:id/room-types — заменить набор активных типов (REPLACE)
  fastify.put<{ Params: { id: string } }>(
    '/:id/room-types',
    { preHandler: [requireRole('admin', 'engineer', 'manager')] },
    async (request, reply) => {
      const body = setProjectRoomTypesSchema.parse(request.body);
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM project_room_types WHERE project_id = $1', [request.params.id]);
        for (let idx = 0; idx < body.roomTypeIds.length; idx++) {
          await client.query(
            `INSERT INTO project_room_types (project_id, room_type_id, sort_order)
             VALUES ($1, $2, $3) ON CONFLICT (project_id, room_type_id) DO NOTHING`,
            [request.params.id, body.roomTypeIds[idx], idx],
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      const { rows } = await fastify.pool.query(
        `SELECT rt.* FROM project_room_types prt
           JOIN room_types rt ON rt.id = prt.room_type_id
          WHERE prt.project_id = $1 ORDER BY prt.sort_order, rt.sort_order, rt.name`,
        [request.params.id],
      );
      return reply.send({ data: rows });
    },
  );
}
