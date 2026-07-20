import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit } from '../../lib/audit.js';
import {
  PROCUREMENT_ASSIGN_ROLES,
  setCategoryResponsibleSchema,
  setCostTypeResponsibleSchema,
  setMaterialResponsibleSchema,
  bulkSetMaterialResponsibleSchema,
  transferAssignmentsSchema,
  createSubstitutionSchema,
  updateSubstitutionSchema,
  setCategoryResponsiblesSchema,
} from '@estimat/shared';
import {
  loadResponsibleTree, loadUserAssignments, loadAssignableUsers, assertAssignable,
} from '../../lib/procurement/responsibles.js';

/**
 * Справочник «Закупки»: ответственные за категории и виды затрат + замещения.
 *
 * Модель (0071): один ответственный на область, три уровня наследования
 * материал → вид затрат → категория. Читают все внутренние роли (справочник нужен и своду
 * «Материалы»), правят только PROCUREMENT_ASSIGN_ROLES (manager/admin) — инженер потерял это
 * право вместе с переходом на новую модель.
 *
 * Право вести заказ по материалам области проверяется отдельно
 * (server/src/lib/procurement/access.ts) и применяется во всех мутациях supplier-orders.
 */
export default async function procurementRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('admin', 'engineer', 'manager')); // contractor — 403

  const canAssign = requireRole(...PROCUREMENT_ASSIGN_ROLES);

  // ============================================================
  // GET /responsibles — дерево «категория → виды затрат» с ответственными
  // ============================================================
  fastify.get('/responsibles', async () => {
    const rows = await loadResponsibleTree(fastify.pool);
    // Deprecated-поле responsibles: незакрытая старая вкладка SPA читает массив и упала бы на
    // его отсутствии. Отдаём 0 или 1 элемент — ровно текущего ответственного категории.
    const data = (rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      responsibles: r.responsible_id
        ? [{ id: r.responsible_id, full_name: r.responsible_name, is_active: true }]
        : [],
    }));
    return { data };
  });

  // ============================================================
  // GET /assignable-users — кандидаты в ответственные
  // ============================================================
  fastify.get('/assignable-users', async () => {
    return { data: await loadAssignableUsers(fastify.pool) };
  });

  // ============================================================
  // GET /responsibles/by-user/:userId — все назначения сотрудника + его замещения
  // ============================================================
  fastify.get<{ Params: { userId: string } }>('/responsibles/by-user/:userId', async (request) => {
    const { userId } = request.params;
    const [assignments, subs] = await Promise.all([
      loadUserAssignments(fastify.pool, userId),
      fastify.pool.query(
        `SELECT s.id, s.principal_user_id, s.deputy_user_id, s.starts_on, s.ends_on,
                s.ended_at, s.reason,
                pu.full_name AS principal_name, du.full_name AS deputy_name,
                (s.ended_at IS NULL
                 AND (now() AT TIME ZONE 'Europe/Moscow')::date BETWEEN s.starts_on AND s.ends_on) AS is_active
           FROM procurement_substitutions s
           LEFT JOIN users pu ON pu.id = s.principal_user_id
           LEFT JOIN users du ON du.id = s.deputy_user_id
          WHERE s.principal_user_id = $1 OR s.deputy_user_id = $1
          ORDER BY s.starts_on DESC`,
        [userId],
      ),
    ]);
    return { data: { ...assignments, substitutions: subs.rows } };
  });

  // ============================================================
  // PUT /responsibles/category/:categoryId — ответственный за категорию
  // ============================================================
  fastify.put<{ Params: { categoryId: string } }>(
    '/responsibles/category/:categoryId',
    { preHandler: [canAssign] },
    async (request, reply) => {
      const { categoryId } = request.params;
      const body = setCategoryResponsibleSchema.parse(request.body);

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // Сериализация параллельных PUT по одной категории.
        const { rows: cat } = await client.query(
          'SELECT id FROM cost_categories WHERE id = $1 FOR UPDATE', [categoryId],
        );
        if (!cat[0]) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Категория не найдена' }); }

        if (body.userId && !(await assertAssignable(client, body.userId))) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Пользователь не найден, неактивен или не может быть ответственным' });
        }

        const { rows: before } = await client.query(
          'SELECT user_id FROM procurement_category_responsible WHERE category_id = $1', [categoryId],
        );

        if (body.userId) {
          await client.query(
            `INSERT INTO procurement_category_responsible (category_id, user_id, assigned_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (category_id) DO UPDATE
                SET user_id = EXCLUDED.user_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
            [categoryId, body.userId, request.currentUser.id],
          );
        } else {
          await client.query('DELETE FROM procurement_category_responsible WHERE category_id = $1', [categoryId]);
        }

        // «Назначили на категорию — применилось ко всем видам»: снимаем индивидуальные назначения,
        // и виды снова наследуют категорийного ответственного.
        let clearedTypes = 0;
        if (body.clearTypeOverrides) {
          const { rowCount } = await client.query(
            `DELETE FROM procurement_cost_type_responsible
              WHERE cost_type_id IN (SELECT id FROM cost_types WHERE category_id = $1)`,
            [categoryId],
          );
          clearedTypes = rowCount ?? 0;
        }

        await recordAudit(client, {
          estimateId: null,
          entityType: 'procurement_responsibles',
          entityId: categoryId,
          action: 'procurement.category.responsible.set',
          userId: request.currentUser.id,
          changes: { before: before[0]?.user_id ?? null, after: body.userId, clearedTypes },
        });
        await client.query('COMMIT');
        return { data: { categoryId, userId: body.userId, clearedTypes } };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // ============================================================
  // PUT /responsibles/cost-type/:costTypeId — ответственный за вид затрат
  // ============================================================
  fastify.put<{ Params: { costTypeId: string } }>(
    '/responsibles/cost-type/:costTypeId',
    { preHandler: [canAssign] },
    async (request, reply) => {
      const { costTypeId } = request.params;
      const body = setCostTypeResponsibleSchema.parse(request.body);

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: ct } = await client.query(
          'SELECT id FROM cost_types WHERE id = $1 FOR UPDATE', [costTypeId],
        );
        if (!ct[0]) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Вид затрат не найден' }); }

        if (body.userId && !(await assertAssignable(client, body.userId))) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Пользователь не найден, неактивен или не может быть ответственным' });
        }

        const { rows: before } = await client.query(
          'SELECT user_id FROM procurement_cost_type_responsible WHERE cost_type_id = $1', [costTypeId],
        );

        if (body.userId) {
          await client.query(
            `INSERT INTO procurement_cost_type_responsible (cost_type_id, user_id, assigned_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (cost_type_id) DO UPDATE
                SET user_id = EXCLUDED.user_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
            [costTypeId, body.userId, request.currentUser.id],
          );
        } else {
          await client.query('DELETE FROM procurement_cost_type_responsible WHERE cost_type_id = $1', [costTypeId]);
        }

        await recordAudit(client, {
          estimateId: null,
          entityType: 'procurement_responsibles',
          entityId: costTypeId,
          action: 'procurement.cost_type.responsible.set',
          userId: request.currentUser.id,
          changes: { before: before[0]?.user_id ?? null, after: body.userId },
        });
        await client.query('COMMIT');
        return { data: { costTypeId, userId: body.userId } };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // ============================================================
  // PUT /responsibles/material — точечный ответственный за материал в области
  // PATCH /responsibles/material/bulk — то же для набора областей
  // ============================================================
  fastify.put('/responsibles/material', { preHandler: [canAssign] }, async (request, reply) => {
    const body = setMaterialResponsibleSchema.parse(request.body);
    const res = await applyMaterialResponsible(fastify, request.currentUser.id, [body.scope], body.userId);
    if (!res.ok) return reply.status(res.code).send({ error: res.error });
    return { data: res.data };
  });

  fastify.patch('/responsibles/material/bulk', { preHandler: [canAssign] }, async (request, reply) => {
    const body = bulkSetMaterialResponsibleSchema.parse(request.body);
    const res = await applyMaterialResponsible(fastify, request.currentUser.id, body.scopes, body.userId);
    if (!res.ok) return reply.status(res.code).send({ error: res.error });
    return { data: res.data };
  });

  /**
   * Запись назначения по областям. Одна строка на область — количество затронутых строк свода
   * при этом больше: назначение действует на все даты поставки материала и на будущие заявки.
   * userId=null — снять назначение и вернуть наследование от вида/категории.
   */
  async function applyMaterialResponsible(
    app: FastifyInstance,
    actorId: string,
    scopes: { projectId: string | null; contractorId: string | null; costTypeId: string | null; aggKey: string }[],
    userId: string | null,
  ): Promise<{ ok: true; data: { scopes: number } } | { ok: false; code: number; error: string }> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      if (userId && !(await assertAssignable(client, userId))) {
        await client.query('ROLLBACK');
        return { ok: false, code: 400, error: 'Пользователь не найден, неактивен или не может быть ответственным' };
      }

      const projectIds = scopes.map((s) => s.projectId);
      const contractorIds = scopes.map((s) => s.contractorId);
      const costTypeIds = scopes.map((s) => s.costTypeId);
      const aggKeys = scopes.map((s) => s.aggKey);

      if (userId) {
        await client.query(
          `INSERT INTO procurement_material_responsible
                 (project_id, contractor_id, cost_type_id, agg_key, user_id, assigned_by)
           SELECT p, c, t, k, $5, $6
             FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[]) AS s(p, c, t, k)
           ON CONFLICT ON CONSTRAINT ux_pmr_scope DO UPDATE
              SET user_id = EXCLUDED.user_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
          [projectIds, contractorIds, costTypeIds, aggKeys, userId, actorId],
        );
      } else {
        await client.query(
          `DELETE FROM procurement_material_responsible r
             USING unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[]) AS s(p, c, t, k)
            WHERE r.project_id    IS NOT DISTINCT FROM s.p
              AND r.contractor_id IS NOT DISTINCT FROM s.c
              AND r.cost_type_id  IS NOT DISTINCT FROM s.t
              AND r.agg_key = s.k`,
          [projectIds, contractorIds, costTypeIds, aggKeys],
        );
      }

      // Сущность события — пользователь, чьи назначения меняются (при снятии — исполнитель):
      // у набора областей общего идентификатора нет, а audit_log.entity_id обязателен.
      await recordAudit(client, {
        estimateId: null,
        entityType: 'procurement_responsibles',
        entityId: userId ?? actorId,
        action: 'procurement.material.responsible.set',
        userId: actorId,
        changes: { userId, scopes: scopes.length, sample: scopes.slice(0, 5) },
      });
      await client.query('COMMIT');
      return { ok: true, data: { scopes: scopes.length } };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // POST /responsibles/transfer — передача назначений другому сотруднику
  // ============================================================
  fastify.post('/responsibles/transfer', { preHandler: [canAssign] }, async (request, reply) => {
    const body = transferAssignmentsSchema.parse(request.body);

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      if (!(await assertAssignable(client, body.toUserId))) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Получатель не найден, неактивен или не может быть ответственным' });
      }

      // Пустой список = «передать всё этого уровня»; заданный — только указанное.
      const cats = await client.query(
        `UPDATE procurement_category_responsible SET user_id = $2, assigned_by = $3, assigned_at = now()
          WHERE user_id = $1 AND ($4::uuid[] IS NULL OR category_id = ANY($4))`,
        [body.fromUserId, body.toUserId, request.currentUser.id, body.categoryIds ?? null],
      );
      const types = await client.query(
        `UPDATE procurement_cost_type_responsible SET user_id = $2, assigned_by = $3, assigned_at = now()
          WHERE user_id = $1 AND ($4::uuid[] IS NULL OR cost_type_id = ANY($4))`,
        [body.fromUserId, body.toUserId, request.currentUser.id, body.costTypeIds ?? null],
      );
      const mats = await client.query(
        `UPDATE procurement_material_responsible SET user_id = $2, assigned_by = $3, assigned_at = now()
          WHERE user_id = $1 AND ($4::uuid[] IS NULL OR id = ANY($4))`,
        [body.fromUserId, body.toUserId, request.currentUser.id, body.materialIds ?? null],
      );

      await recordAudit(client, {
        estimateId: null,
        entityType: 'procurement_responsibles',
        entityId: body.fromUserId,
        action: 'procurement.responsibles.transferred',
        userId: request.currentUser.id,
        changes: {
          from: body.fromUserId, to: body.toUserId,
          categories: cats.rowCount ?? 0, costTypes: types.rowCount ?? 0, materials: mats.rowCount ?? 0,
        },
      });
      await client.query('COMMIT');
      return {
        data: { categories: cats.rowCount ?? 0, costTypes: types.rowCount ?? 0, materials: mats.rowCount ?? 0 },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // Замещения
  // ============================================================
  fastify.get<{ Querystring: { userId?: string; active?: string } }>('/substitutions', async (request) => {
    const q = request.query;
    const where: string[] = [];
    const values: unknown[] = [];
    if (q.userId) {
      values.push(q.userId);
      where.push(`(s.principal_user_id = $${values.length} OR s.deputy_user_id = $${values.length})`);
    }
    if (q.active === '1') {
      where.push(`s.ended_at IS NULL AND (now() AT TIME ZONE 'Europe/Moscow')::date BETWEEN s.starts_on AND s.ends_on`);
    }
    const { rows } = await fastify.pool.query(
      `SELECT s.id, s.principal_user_id, s.deputy_user_id, s.starts_on, s.ends_on, s.ended_at, s.reason,
              pu.full_name AS principal_name, du.full_name AS deputy_name,
              (s.ended_at IS NULL
               AND (now() AT TIME ZONE 'Europe/Moscow')::date BETWEEN s.starts_on AND s.ends_on) AS is_active
         FROM procurement_substitutions s
         LEFT JOIN users pu ON pu.id = s.principal_user_id
         LEFT JOIN users du ON du.id = s.deputy_user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY s.starts_on DESC`,
      values,
    );
    return { data: rows };
  });

  fastify.post('/substitutions', { preHandler: [canAssign] }, async (request, reply) => {
    const body = createSubstitutionSchema.parse(request.body);

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      // Блокируем строки users обоих участников в порядке id: FOR UPDATE по самой таблице
      // замещений ничего не заблокировал бы, пока строк нет, и два параллельных запроса создали
      // бы пересекающиеся периоды (EXCLUDE-констрейнт недоступен без btree_gist).
      await client.query(
        `SELECT id FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`,
        [body.principalUserId, body.deputyUserId],
      );

      for (const uid of [body.principalUserId, body.deputyUserId]) {
        if (!(await assertAssignable(client, uid))) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Участник замещения не найден, неактивен или не может быть ответственным' });
        }
      }

      // Пересечение по замещаемому — период должен быть однозначен.
      const { rows: overlap } = await client.query(
        `SELECT 1 FROM procurement_substitutions
          WHERE principal_user_id = $1 AND ended_at IS NULL
            AND daterange(starts_on, ends_on, '[]') && daterange($2::date, $3::date, '[]')`,
        [body.principalUserId, body.startsOn, body.endsOn],
      );
      if (overlap.length) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'На этот период замещение уже назначено' });
      }

      // Цепочки запрещены симметрично: замещающий не может сам быть замещаемым в пересекающийся
      // период, и наоборот — иначе пришлось бы разворачивать цепочку A→B→C.
      const { rows: chain } = await client.query(
        `SELECT 1 FROM procurement_substitutions
          WHERE ended_at IS NULL
            AND daterange(starts_on, ends_on, '[]') && daterange($2::date, $3::date, '[]')
            AND (principal_user_id = $1 OR deputy_user_id = $4)`,
        [body.deputyUserId, body.startsOn, body.endsOn, body.principalUserId],
      );
      if (chain.length) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Замещающий сам замещается в этот период — цепочка замещений не поддерживается' });
      }

      const { rows } = await client.query(
        `INSERT INTO procurement_substitutions
               (principal_user_id, deputy_user_id, starts_on, ends_on, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [body.principalUserId, body.deputyUserId, body.startsOn, body.endsOn, body.reason ?? null, request.currentUser.id],
      );

      await recordAudit(client, {
        estimateId: null,
        entityType: 'procurement_substitution',
        entityId: rows[0].id,
        action: 'procurement.substitution.create',
        userId: request.currentUser.id,
        changes: { ...body },
      });
      await client.query('COMMIT');
      return { data: { id: rows[0].id } };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  fastify.patch<{ Params: { id: string } }>('/substitutions/:id', { preHandler: [canAssign] }, async (request, reply) => {
    const body = updateSubstitutionSchema.parse(request.body);
    const sets: string[] = [];
    const values: unknown[] = [request.params.id];
    for (const [col, val] of [
      ['deputy_user_id', body.deputyUserId], ['starts_on', body.startsOn],
      ['ends_on', body.endsOn], ['reason', body.reason],
    ] as const) {
      if (val !== undefined) { values.push(val); sets.push(`${col} = $${values.length}`); }
    }
    if (!sets.length) return reply.status(400).send({ error: 'Нет изменений' });

    const { rows } = await fastify.pool.query(
      `UPDATE procurement_substitutions SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, values,
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Замещение не найдено' });
    return { data: { id: rows[0].id } };
  });

  /**
   * Досрочное завершение. Отдельное поле ended_at, а не правка ends_on: дата окончания
   * включительна, поэтому «завершить сегодня» через ends_on оставило бы заместителя действующим
   * до полуночи. Плановый период сохраняется для истории.
   */
  fastify.post<{ Params: { id: string } }>('/substitutions/:id/end', { preHandler: [canAssign] }, async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `UPDATE procurement_substitutions SET ended_at = now(), ended_by = $2
        WHERE id = $1 AND ended_at IS NULL RETURNING id`,
      [request.params.id, request.currentUser.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Замещение не найдено или уже завершено' });
    return { data: { id: rows[0].id } };
  });

  fastify.delete<{ Params: { id: string } }>('/substitutions/:id', { preHandler: [canAssign] }, async (request, reply) => {
    // Удалять можно только не начавшееся: действующее и прошедшее нужны истории «кто фактически
    // отвечал в июле» — их завершают через /end.
    const { rows } = await fastify.pool.query(
      `DELETE FROM procurement_substitutions
        WHERE id = $1 AND starts_on > (now() AT TIME ZONE 'Europe/Moscow')::date RETURNING id`,
      [request.params.id],
    );
    if (!rows[0]) return reply.status(409).send({ error: 'Удалить можно только ещё не начавшееся замещение' });
    return { data: { id: rows[0].id } };
  });

  // ============================================================
  // PUT /responsibles/:categoryId — LEGACY (модель «много ответственных»)
  // ============================================================
  // Не удалён, чтобы незакрытая вкладка SPA не писала в мёртвую таблицу: перенаправляем на
  // одиночную модель. Набор длиннее одного элемента в новой модели невыразим.
  fastify.put<{ Params: { categoryId: string } }>(
    '/responsibles/:categoryId',
    { preHandler: [canAssign] },
    async (request, reply) => {
      const { userIds } = setCategoryResponsiblesSchema.parse(request.body);
      if (userIds.length > 1) {
        return reply.status(400).send({ error: 'Теперь у категории один ответственный — обновите страницу' });
      }
      const userId = userIds[0] ?? null;
      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        if (userId) {
          if (!(await assertAssignable(client, userId))) {
            await client.query('ROLLBACK');
            return reply.status(400).send({ error: 'Пользователь не найден или неактивен' });
          }
          await client.query(
            `INSERT INTO procurement_category_responsible (category_id, user_id, assigned_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (category_id) DO UPDATE
                SET user_id = EXCLUDED.user_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
            [request.params.categoryId, userId, request.currentUser.id],
          );
        } else {
          await client.query('DELETE FROM procurement_category_responsible WHERE category_id = $1', [request.params.categoryId]);
        }
        await client.query('COMMIT');
        return { data: { categoryId: request.params.categoryId, userIds: userId ? [userId] : [] } };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
