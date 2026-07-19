import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit } from '../../lib/audit.js';
import { setCategoryResponsiblesSchema } from '@estimat/shared';

/**
 * Справочник «Закупки»: закрепление категорий работ за ответственными (procurement_category_responsibles).
 * Читают все внутренние роли (нужно и справочнику, и своду «Материалы»); правят admin/engineer.
 * Ответственные за категорию + админы распределяют материалы этой категории в заказы поставщику
 * (проверка — server/src/lib/procurement/access.ts, применяется в supplier-orders).
 */
export default async function procurementRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('admin', 'engineer', 'manager')); // contractor — 403

  // ============================================================
  // GET /responsibles — категории работ + назначенные ответственные.
  //   Показываем активные категории И архивные, по которым есть назначения (чтобы старое
  //   назначение можно было увидеть/снять). Пустая категория → responsibles: [].
  // ============================================================
  fastify.get('/responsibles', async () => {
    const { rows } = await fastify.pool.query(
      `SELECT cc.id, cc.name, cc.code, cc.sort_order, cc.is_active,
              COALESCE(
                json_agg(
                  json_build_object('id', u.id, 'full_name', u.full_name, 'role', u.role, 'is_active', u.is_active)
                  ORDER BY u.full_name
                ) FILTER (WHERE u.id IS NOT NULL),
                '[]'
              ) AS responsibles
         FROM cost_categories cc
         LEFT JOIN procurement_category_responsibles pcr ON pcr.category_id = cc.id
         LEFT JOIN users u ON u.id = pcr.user_id
        WHERE cc.is_active = true OR pcr.id IS NOT NULL
        GROUP BY cc.id
        ORDER BY cc.sort_order, cc.name`,
    );
    return { data: rows };
  });

  // ============================================================
  // GET /assignable-users — кандидаты в ответственные (активные внутренние роли).
  //   GET /api/users закрыт admin-only, поэтому свой лёгкий список.
  // ============================================================
  fastify.get('/assignable-users', { preHandler: [requireRole('admin', 'engineer', 'manager')] }, async () => {
    const { rows } = await fastify.pool.query(
      `SELECT id, full_name, role FROM users
        WHERE is_active = true AND role IN ('admin', 'engineer', 'manager')
        ORDER BY full_name`,
    );
    return { data: rows };
  });

  // ============================================================
  // PUT /responsibles/:categoryId — полная замена набора ответственных категории.
  // ============================================================
  fastify.put<{ Params: { categoryId: string } }>(
    '/responsibles/:categoryId',
    { preHandler: [requireRole('admin', 'engineer')] },
    async (request, reply) => {
      const { categoryId } = request.params;
      const { userIds } = setCategoryResponsiblesSchema.parse(request.body);
      const uniqueIds = [...new Set(userIds)];
      if (uniqueIds.length !== userIds.length) {
        return reply.status(400).send({ error: 'В списке есть повторяющиеся пользователи' });
      }

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');
        // Сериализация параллельных PUT по одной категории.
        const { rows: catRows } = await client.query(
          'SELECT id FROM cost_categories WHERE id = $1 FOR UPDATE',
          [categoryId],
        );
        if (!catRows[0]) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Категория не найдена' });
        }

        // Кандидаты обязаны существовать, быть активными и не подрядчиками.
        if (uniqueIds.length > 0) {
          const { rows: valid } = await client.query(
            `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND is_active = true AND role <> 'contractor'`,
            [uniqueIds],
          );
          if (valid.length !== uniqueIds.length) {
            await client.query('ROLLBACK');
            return reply
              .status(400)
              .send({ error: 'Некоторые пользователи не найдены, неактивны или не могут быть ответственными' });
          }
        }

        const { rows: beforeRows } = await client.query(
          'SELECT user_id FROM procurement_category_responsibles WHERE category_id = $1',
          [categoryId],
        );

        await client.query('DELETE FROM procurement_category_responsibles WHERE category_id = $1', [categoryId]);
        for (const uid of uniqueIds) {
          await client.query(
            `INSERT INTO procurement_category_responsibles (category_id, user_id, assigned_by)
             VALUES ($1, $2, $3)`,
            [categoryId, uid, request.currentUser.id],
          );
        }

        await recordAudit(client, {
          estimateId: null,
          entityType: 'procurement_responsibles',
          entityId: categoryId,
          action: 'procurement.responsibles.set',
          userId: request.currentUser.id,
          changes: { before: beforeRows.map((r) => r.user_id), after: uniqueIds },
        });

        await client.query('COMMIT');
        return { data: { categoryId, userIds: uniqueIds } };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
