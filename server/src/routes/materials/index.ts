import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createMaterialGroupSchema, createMaterialSchema, updateMaterialSchema, setMaterialVerifiedSchema } from '@estimat/shared';

export default async function materialRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // === Material Groups ===

  // GET /api/materials/groups
  fastify.get('/groups', async () => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM material_groups ORDER BY name',
    );
    return { data: rows };
  });

  // POST /api/materials/groups
  fastify.post('/groups', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createMaterialGroupSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO material_groups (name, parent_id, code)
       VALUES ($1, $2, $3) RETURNING *`,
      [body.name, body.parentId || null, body.code || null],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // DELETE /api/materials/groups/:id
  fastify.delete<{ Params: { id: string } }>('/groups/:id', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'DELETE FROM material_groups WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Группа не найдена' });
    return { success: true };
  });

  // === Materials ===

  // GET /api/materials/tree — дерево групп (по parent_id) с материалами на листьях:
  // Категория → Вид работ → Материалы (зеркало справочника работ). Материалы без группы — отдельно.
  fastify.get('/tree', async () => {
    interface GroupRow { id: string; name: string; parent_id: string | null; code: string | null }
    interface MatRow { id: string; name: string; group_id: string | null; unit: string; unit_price: string; is_verified: boolean }
    interface GroupNode extends GroupRow { children: GroupNode[]; materials: MatRow[] }

    const { rows: groups } = await fastify.pool.query(
      'SELECT id, name, parent_id, code FROM material_groups ORDER BY name',
    );
    const { rows: materials } = await fastify.pool.query(
      'SELECT id, name, group_id, unit, unit_price, is_verified FROM material_catalog WHERE is_active ORDER BY name',
    );

    const byId = new Map<string, GroupNode>();
    for (const g of groups as GroupRow[]) byId.set(g.id, { ...g, children: [], materials: [] });
    const ungrouped: MatRow[] = [];
    for (const m of materials as MatRow[]) {
      const node = m.group_id ? byId.get(m.group_id) : undefined;
      if (node) node.materials.push(m);
      else ungrouped.push(m);
    }
    const roots: GroupNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return { data: { roots, ungrouped } };
  });

  // GET /api/materials
  fastify.get('/', async (request) => {
    const { groupId } = request.query as { groupId?: string };
    let query = 'SELECT mc.*, mg.name as group_name FROM material_catalog mc LEFT JOIN material_groups mg ON mc.group_id = mg.id WHERE mc.is_active';
    const values: string[] = [];
    if (groupId) {
      query += ' AND mc.group_id = $1';
      values.push(groupId);
    }
    query += ' ORDER BY mc.name';
    const { rows } = await fastify.pool.query(query, values);
    return { data: rows };
  });

  // GET /api/materials/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      'SELECT * FROM material_catalog WHERE id = $1',
      [request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Материал не найден' });
    return { data: rows[0] };
  });

  // POST /api/materials
  fastify.post('/', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = createMaterialSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `INSERT INTO material_catalog (name, group_id, unit, unit_price, description, attributes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.name, body.groupId || null, body.unit, body.unitPrice ?? 0, body.description || null, JSON.stringify(body.attributes || {})],
    );
    return reply.status(201).send({ data: rows[0] });
  });

  // PUT /api/materials/:id
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const body = updateMaterialSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name); }
    if (body.groupId !== undefined) { sets.push(`group_id = $${i++}`); values.push(body.groupId); }
    if (body.unit !== undefined) { sets.push(`unit = $${i++}`); values.push(body.unit); }
    if (body.unitPrice !== undefined) { sets.push(`unit_price = $${i++}`); values.push(body.unitPrice); }
    if (body.description !== undefined) { sets.push(`description = $${i++}`); values.push(body.description); }
    if (body.attributes !== undefined) { sets.push(`attributes = $${i++}`); values.push(JSON.stringify(body.attributes)); }

    if (sets.length === 0) return reply.status(400).send({ error: 'Нет данных для обновления' });

    values.push(request.params.id);
    const { rows } = await fastify.pool.query(
      `UPDATE material_catalog SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Материал не найден' });
    return { data: rows[0] };
  });

  // DELETE /api/materials/:id (мягкое удаление: is_active=false — жёсткий DELETE
  // каскадом удалил бы материал из состава работ, rate_materials ON DELETE CASCADE)
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const { rowCount } = await fastify.pool.query(
      'UPDATE material_catalog SET is_active = false WHERE id = $1',
      [request.params.id],
    );
    if (rowCount === 0) return reply.status(404).send({ error: 'Материал не найден' });
    return { success: true };
  });

  // PATCH /api/materials/:id/verified — отметить/снять «проверенный материал» (курирование каталога,
  // отдельный флаг от is_active). Влияет на галочку в блоке справочника и фильтр «только проверенные».
  fastify.patch<{ Params: { id: string } }>('/:id/verified', { preHandler: [requireRole('admin', 'engineer')] }, async (request, reply) => {
    const { verified } = setMaterialVerifiedSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      'UPDATE material_catalog SET is_verified = $1 WHERE id = $2 RETURNING id, is_verified',
      [verified, request.params.id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Материал не найден' });
    return { data: rows[0] };
  });
}
