import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../middleware/requireRole.js';
import {
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

// Построение дерева зон из parent_id в памяти (паттерн materials.get('/tree')).
function buildZoneTree(rows: ZoneRow[]): { roots: ZoneNode[] } {
  const byId = new Map<string, ZoneNode>();
  for (const z of rows) byId.set(z.id, { ...z, children: [] });
  const roots: ZoneNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return { roots };
}

// Локации объекта: зоны (география), произвольные «типы» строк, активные типы помещений.
export function registerLocationRoutes(fastify: FastifyInstance): void {
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
    return { data: buildZoneTree(rows) };
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
      return reply.send({ data: buildZoneTree(rows) });
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
