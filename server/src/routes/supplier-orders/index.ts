import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { formLotSchema, startProcurementSchema, addOfferSchema, awardSchema } from '@estimat/shared';
import { config } from '../../config.js';
import { recalcRequestStatus } from '../../lib/requests/status-recalc.js';
import { appendOrderAudit } from '../../lib/supplier-orders/helpers.js';
import { exportSupplierOrderXlsx, SupplierOrderExportError } from '../../lib/supplier-order-export/index.js';
import { getTenderClient } from '../../lib/tender/client.js';
import { refreshTenderLot } from '../../lib/tender/sync.js';
import { TenderApiError, TenderNotConfiguredError } from '../../lib/tender/errors.js';

/**
 * Закупочные лоты СУ-10 (supplier_orders.kind='sourcing'). Инструмент снабжения — доступ только
 * внутренним ролям (admin/engineer/manager). Лот сводит материалы из нескольких su10-заявок
 * (связь заявка↔лот многие-ко-многим по количеству через supplier_order_items).
 *
 * Инвариант И1 (нет закупки сверх заявленного): любое изменение состава — в транзакции с блокировкой
 * исходных строк material_request_items (FOR UPDATE), пересчётом размещённого по активным лотам
 * (numeric в SQL) и optimistic-lock лота (row_version). Количество позиции в лоте — абсолютное.
 */
export default async function supplierOrderRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('admin', 'engineer', 'manager'));

  // ============================================================
  // GET /materials — свод материалов su10-заявок объекта (обязателен projectId).
  //   Строки = исходные позиции заявок (1:1 с формированием лота), с вычетом размещённого
  //   в активные лоты. Клиент группирует визуально и выбирает строки с remaining>0.
  // ============================================================
  fastify.get<{ Querystring: { projectId?: string; contractorId?: string } }>('/materials', async (request) => {
    const q = request.query;
    if (!q.projectId) return { data: [] };
    const values: unknown[] = [q.projectId];
    let contractorFilter = '';
    if (q.contractorId) {
      values.push(q.contractorId);
      contractorFilter = ` AND mr.contractor_id = $${values.length}`;
    }
    const { rows } = await fastify.pool.query(
      `SELECT mri.id AS request_item_id, mri.request_id, mr.request_no,
              mri.cost_type_id, ct.name AS cost_type_name,
              cc.id AS category_id, cc.name AS category_name,
              cc.sort_order AS category_sort, ct.sort_order AS cost_type_sort,
              mri.material_id, mri.material_name, mri.unit, mri.agg_key,
              mri.quantity::numeric AS requested, COALESCE(placed.qty, 0)::numeric AS ordered,
              mr.contractor_id, mr.contractor_name
         FROM material_request_items mri
         JOIN material_requests mr ON mr.id = mri.request_id
              AND mr.request_type = 'su10' AND mr.status <> 'cancelled'
         LEFT JOIN cost_types ct ON ct.id = mri.cost_type_id
         LEFT JOIN cost_categories cc ON cc.id = ct.category_id
         LEFT JOIN (
           SELECT soi.request_item_id, SUM(soi.quantity) AS qty
             FROM supplier_order_items soi
             JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status <> 'cancelled'
            GROUP BY soi.request_item_id
         ) placed ON placed.request_item_id = mri.id
        WHERE mr.project_id = $1${contractorFilter}
        ORDER BY cc.sort_order NULLS LAST, ct.sort_order NULLS LAST, mri.material_name`,
      values,
    );
    return {
      data: rows.map((r) => ({ ...r, remaining: Number(r.requested) - Number(r.ordered) })),
    };
  });

  // ============================================================
  // POST / — сформировать новый лот или добавить позиции в существующий (forming)
  // ============================================================
  fastify.post('/', async (request, reply) => {
    const user = request.currentUser;
    const body = formLotSchema.parse(request.body);
    const itemIds = body.items.map((i) => i.requestItemId);
    const wantQty = body.items.map((i) => String(i.quantity));

    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');

      // --- Резолв лота: append (по orderId) или create (идемпотентно по clientRequestId) ---
      let orderId: string;
      if (body.orderId) {
        const { rows } = await client.query(
          `SELECT id, project_id, sourcing_status, row_version FROM supplier_orders
            WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
          [body.orderId],
        );
        const lot = rows[0];
        if (!lot) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Лот не найден' });
        }
        if (lot.sourcing_status !== 'forming') {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Лот заморожен — состав менять нельзя' });
        }
        if (lot.project_id !== body.projectId) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Лот относится к другому объекту' });
        }
        if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Лот изменён, обновите страницу', rowVersion: lot.row_version });
        }
        orderId = lot.id;
      } else {
        const dup = await client.query(
          `SELECT id FROM supplier_orders WHERE created_by = $1 AND client_request_id = $2`,
          [user.id, body.clientRequestId],
        );
        if (dup.rows[0]) {
          orderId = dup.rows[0].id; // повтор запроса — тот же лот (позиции UPSERT'ятся идемпотентно)
        } else {
          await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [body.projectId]);
          const { rows: pRows } = await client.query('SELECT name FROM projects WHERE id = $1', [body.projectId]);
          if (!pRows[0]) {
            await client.query('ROLLBACK');
            return reply.status(404).send({ error: 'Объект не найден' });
          }
          const { rows: noRows } = await client.query(
            `SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM supplier_orders WHERE project_id = $1 AND kind = 'sourcing'`,
            [body.projectId],
          );
          const { rows: insRows } = await client.query(
            `INSERT INTO supplier_orders
               (kind, project_id, project_name, order_no, title, sourcing_status, client_request_id, created_by)
             VALUES ('sourcing', $1, $2, $3, $4, 'forming', $5, $6)
             RETURNING id`,
            [body.projectId, pRows[0].name ?? null, Number(noRows[0].n), body.title ?? null, body.clientRequestId, user.id],
          );
          orderId = insRows[0].id;
        }
      }

      // --- Блокировка исходных строк (И1, стабильный порядок по id) + снимки для позиций лота ---
      const { rows: src } = await client.query(
        `SELECT mri.id, mri.request_id, mri.cost_type_id, mri.agg_key, mri.material_id, mri.material_name,
                mri.unit, mr.contractor_id, mr.contractor_name, mr.request_no, mr.project_id, mr.request_type,
                ct.name AS cost_type_name, cc.name AS cost_category_name
           FROM material_request_items mri
           JOIN material_requests mr ON mr.id = mri.request_id
           LEFT JOIN cost_types ct ON ct.id = mri.cost_type_id
           LEFT JOIN cost_categories cc ON cc.id = ct.category_id
          WHERE mri.id = ANY($1::uuid[])
          ORDER BY mri.id
          FOR UPDATE OF mri`,
        [itemIds],
      );
      const srcMap = new Map(src.map((r) => [r.id, r]));
      for (const it of body.items) {
        const r = srcMap.get(it.requestItemId);
        if (!r) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Строка заявки не найдена' });
        }
        if (r.request_type !== 'su10') {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'В лот попадают только материалы заявок СУ-10' });
        }
        if (r.project_id !== body.projectId) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Материал относится к другому объекту' });
        }
      }

      // --- Проверка остатка в SQL (numeric): want > requested − размещённое в ДРУГИХ активных лотах ---
      const { rows: viol } = await client.query(
        `WITH req(request_item_id, want) AS (
           SELECT * FROM unnest($1::uuid[], $2::numeric[])
         )
         SELECT req.request_item_id::text AS request_item_id, mri.material_name,
                mri.quantity AS requested, COALESCE(pl.qty, 0) AS placed, req.want
           FROM req
           JOIN material_request_items mri ON mri.id = req.request_item_id
           LEFT JOIN (
             SELECT soi.request_item_id, SUM(soi.quantity) AS qty
               FROM supplier_order_items soi
               JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status <> 'cancelled'
              WHERE soi.order_id <> $3
              GROUP BY soi.request_item_id
           ) pl ON pl.request_item_id = req.request_item_id
          WHERE req.want > mri.quantity - COALESCE(pl.qty, 0)`,
        [itemIds, wantQty, orderId],
      );
      if (viol.length) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          error: 'Превышен доступный остаток по материалам',
          items: viol.map((v) => ({
            requestItemId: v.request_item_id,
            name: v.material_name,
            remaining: Number(v.requested) - Number(v.placed),
            requested: Number(v.want),
          })),
        });
      }

      // --- UPSERT позиций (количество абсолютное) ---
      for (const it of body.items) {
        const r = srcMap.get(it.requestItemId)!;
        await client.query(
          `INSERT INTO supplier_order_items
             (order_id, request_id, request_item_id, cost_type_id, material_id, material_name, unit, agg_key,
              quantity, contractor_id, contractor_name, request_no, cost_type_name, cost_category_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (order_id, request_item_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
          [
            orderId, r.request_id, r.id, r.cost_type_id, r.material_id, r.material_name, r.unit, r.agg_key,
            it.quantity, r.contractor_id, r.contractor_name, r.request_no, r.cost_type_name, r.cost_category_name,
          ],
        );
      }

      await client.query('UPDATE supplier_orders SET row_version = row_version + 1, updated_at = now() WHERE id = $1', [orderId]);
      await appendOrderAudit(client, {
        orderId, action: 'items_added', userId: user.id,
        changes: { count: body.items.length }, projectId: body.projectId,
      });
      for (const rid of new Set(src.map((r) => r.request_id))) {
        await recalcRequestStatus(client, rid as string, user.id);
      }

      const { rows: fin } = await client.query('SELECT order_no, row_version FROM supplier_orders WHERE id = $1', [orderId]);
      await client.query('COMMIT');
      return reply.status(201).send({ data: { id: orderId, orderNo: fin[0].order_no, rowVersion: fin[0].row_version } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // DELETE /:id/items/:itemId — убрать позицию из формируемого лота
  // ============================================================
  fastify.delete<{ Params: { id: string; itemId: string } }>('/:id/items/:itemId', async (request, reply) => {
    const user = request.currentUser;
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Лот не найден' }); }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Лот заморожен — состав менять нельзя' });
      }
      const { rows: delRows } = await client.query(
        `DELETE FROM supplier_order_items WHERE id = $1 AND order_id = $2 RETURNING request_id`,
        [request.params.itemId, lot.id],
      );
      if (!delRows[0]) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Позиция не найдена' }); }
      await client.query('UPDATE supplier_orders SET row_version = row_version + 1, updated_at = now() WHERE id = $1', [lot.id]);
      await appendOrderAudit(client, { orderId: lot.id, action: 'item_removed', userId: user.id, projectId: lot.project_id });
      if (delRows[0].request_id) await recalcRequestStatus(client, delRows[0].request_id, user.id);
      await client.query('COMMIT');
      return { data: { ok: true } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // DELETE /:id — удалить формируемый лот целиком (позиции CASCADE)
  // ============================================================
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = request.currentUser;
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Лот не найден' }); }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Удалить можно только формируемый лот' });
      }
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [lot.id]);
      await client.query('DELETE FROM supplier_orders WHERE id = $1', [lot.id]);
      await appendOrderAudit(client, { orderId: lot.id, action: 'deleted', userId: user.id, projectId: lot.project_id });
      for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, user.id);
      await client.query('COMMIT');
      return { data: { ok: true } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/cancel — отменить лот (освобождает остаток; для внешнего тендера — cancel_pending)
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const user = request.currentUser;
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, tender_portal_id, tender_status
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Лот не найден' }); }
      if (['cancelled', 'cancel_pending', 'awarded'].includes(lot.sourcing_status)) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Лот уже нельзя отменить' });
      }
      // Активный внешний тендер — запрашиваем отмену на портале; остаток держим (cancel_pending)
      // до подтверждения площадкой (poller переведёт в cancelled и освободит остаток).
      const tenderActive = lot.tender_portal_id && ['draft', 'published', 'awaiting_results'].includes(lot.tender_status);
      const next = tenderActive ? 'cancel_pending' : 'cancelled';
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [lot.id]);
      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = $2, row_version = row_version + 1, updated_at = now(),
                tender_next_poll_at = CASE WHEN $3::boolean THEN now() ELSE tender_next_poll_at END
          WHERE id = $1`,
        [lot.id, next, tenderActive],
      );
      await appendOrderAudit(client, { orderId: lot.id, action: 'cancelled', userId: user.id, changes: { next }, projectId: lot.project_id });
      if (next === 'cancelled') for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, user.id);
      await client.query('COMMIT');
      // Отмена на площадке — best-effort (poller подтвердит статус и освободит остаток).
      if (tenderActive) {
        try {
          await getTenderClient()?.cancelTender(lot.tender_portal_id);
        } catch (err) {
          fastify.log.warn({ err, orderId: lot.id }, 'tender cancel: портал недоступен, отмена подтвердится опросом');
        }
      }
      return { data: { id: lot.id, sourcingStatus: next } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/start — начать закупку: заморозить состав и выбрать канал.
  //   method='manual' — сбор КП по почте (Excel качается отдельно).
  //   method='tender' — выгрузка лота в тендерный портал (обрабатывается в POST /:id/tender).
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/start', async (request, reply) => {
    const user = request.currentUser;
    const body = startProcurementSchema.parse(request.body);
    if (body.method === 'tender') {
      return reply.status(400).send({ error: 'Для тендера используйте «Создать тендер»' });
    }
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, sourcing_status, row_version FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Лот не найден' }); }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Лот уже в закупке' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Лот изменён, обновите страницу', rowVersion: lot.row_version });
      }
      const { rows: cnt } = await client.query('SELECT count(*)::int AS n FROM supplier_order_items WHERE order_id = $1', [lot.id]);
      if (cnt[0].n === 0) { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Лот пуст' }); }
      await client.query(
        `UPDATE supplier_orders SET sourcing_status = 'sourcing', procurement_method = 'manual',
                row_version = row_version + 1, updated_at = now() WHERE id = $1`,
        [lot.id],
      );
      await appendOrderAudit(client, { orderId: lot.id, action: 'procurement_started', userId: user.id, changes: { method: 'manual' }, projectId: lot.project_id });
      await client.query('COMMIT');
      return { data: { id: lot.id, sourcingStatus: 'sourcing', method: 'manual' } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/tender — начать закупку через тендер: заморозить лот и поставить команду создания
  //   тендера в outbox (И5: портал вызывает ТОЛЬКО worker, синхронного вызова в маршруте нет).
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/tender', async (request, reply) => {
    const user = request.currentUser;
    const body = startProcurementSchema.parse(request.body);
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, project_id, title, order_no, sourcing_status, row_version
           FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Лот не найден' }); }
      if (lot.sourcing_status !== 'forming') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Лот уже в закупке' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Лот изменён, обновите страницу', rowVersion: lot.row_version });
      }
      // Агрегированные позиции лота (без подрядчиков/№ заявок) — предмет тендера.
      const { rows: items } = await client.query(
        `SELECT material_name, unit, SUM(quantity)::numeric AS quantity
           FROM supplier_order_items WHERE order_id = $1
          GROUP BY material_name, unit ORDER BY material_name`,
        [lot.id],
      );
      if (items.length === 0) { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Лот пуст' }); }

      const externalRef = `estimat:lot:${lot.id}`;
      const input = {
        title: lot.title ?? `Закупочный лот № Л-${String(lot.order_no ?? 0).padStart(3, '0')}`,
        external_ref: externalRef,
        deadline_at: body.tender?.deadlineAt ?? null,
        items: items.map((it) => ({ material: it.material_name, quantity: Number(it.quantity), unit: it.unit })),
        conditions: {
          delivery: body.tender?.delivery ?? null,
          payment: body.tender?.payment ?? null,
          deadline: body.tender?.deadline ?? null,
        },
      };
      const payload = { orderId: lot.id, input };
      const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

      await client.query(
        `UPDATE supplier_orders
            SET procurement_method='tender', sourcing_status='sourcing', tender_external_ref=$2,
                tender_sync_status='pending', tender_deadline_at=$3, tender_last_error=NULL,
                row_version=row_version+1, updated_at=now()
          WHERE id=$1`,
        [lot.id, externalRef, body.tender?.deadlineAt ?? null],
      );
      await client.query(
        `INSERT INTO integration_outbox
           (aggregate_type, aggregate_id, command_type, external_ref, payload, payload_hash, status, next_attempt_at)
         VALUES ('supplier_order', $1, 'tender.create', $2, $3::jsonb, $4, 'queued', now())`,
        [lot.id, externalRef, JSON.stringify(payload), payloadHash],
      );
      await appendOrderAudit(client, { orderId: lot.id, action: 'tender_requested', userId: user.id, projectId: lot.project_id });
      await client.query('COMMIT');
      fastify.outbox.kick();
      return reply.status(202).send({ data: { id: lot.id, pending: true, syncEnabled: config.tender.outboundEnabled } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // POST /:id/tender-refresh — ручной опрос результатов тендера с портала сейчас
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/tender-refresh', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT tender_portal_id FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
      [request.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Лот не найден' });
    if (!rows[0].tender_portal_id) return reply.status(409).send({ error: 'Тендер по лоту не создан' });
    try {
      await refreshTenderLot(fastify, request.params.id);
      const { rows: fresh } = await fastify.pool.query(
        `SELECT tender_status, tender_results FROM supplier_orders WHERE id = $1`,
        [request.params.id],
      );
      return { data: { tenderStatus: fresh[0].tender_status, tenderResults: fresh[0].tender_results } };
    } catch (e) {
      if (e instanceof TenderNotConfiguredError) return reply.status(409).send({ error: 'Тендерный портал не настроен' });
      if (e instanceof TenderApiError) return reply.status(502).send({ error: e.message });
      throw e;
    }
  });

  // ============================================================
  // POST /:id/export — Excel «Запрос КП» (для рассылки поставщикам по почте)
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/export', async (request, reply) => {
    try {
      const { buffer, fileName } = await exportSupplierOrderXlsx(fastify.pool, request.params.id);
      await appendOrderAudit(fastify.pool, { orderId: request.params.id, action: 'kp_exported', userId: request.currentUser.id });
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      return reply.send(buffer);
    } catch (e) {
      if (e instanceof SupplierOrderExportError) return reply.status(e.status).send({ error: e.message });
      throw e;
    }
  });

  // ============================================================
  // POST /:id/offers — зарегистрировать КП поставщика (manual-канал, стадия sourcing)
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/offers', async (request, reply) => {
    const user = request.currentUser;
    const body = addOfferSchema.parse(request.body);
    const { rows } = await fastify.pool.query(
      `SELECT id, sourcing_status, procurement_method, project_id FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
      [request.params.id],
    );
    const lot = rows[0];
    if (!lot) return reply.status(404).send({ error: 'Лот не найден' });
    if (lot.sourcing_status !== 'sourcing' || lot.procurement_method !== 'manual') {
      return reply.status(409).send({ error: 'КП добавляются только по лоту в стадии сбора предложений' });
    }
    const { rows: ins } = await fastify.pool.query(
      `INSERT INTO supplier_order_offers
         (order_id, supplier_id, supplier_name, supplier_inn, amount, currency, terms, note, file_id, submitted_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [lot.id, body.supplierId ?? null, body.supplierName, body.supplierInn ?? null, body.amount,
       body.currency ?? 'RUB', body.terms ?? null, body.note ?? null, body.fileId ?? null, body.submittedAt ?? null, user.id],
    );
    await appendOrderAudit(fastify.pool, { orderId: lot.id, action: 'offer_added', userId: user.id, changes: { amount: body.amount }, projectId: lot.project_id });
    return reply.status(201).send({ data: { id: ins[0].id } });
  });

  // DELETE /:id/offers/:offerId — убрать КП (пока лот не присуждён).
  fastify.delete<{ Params: { id: string; offerId: string } }>('/:id/offers/:offerId', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT sourcing_status FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
      [request.params.id],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Лот не найден' });
    if (rows[0].sourcing_status === 'awarded') return reply.status(409).send({ error: 'Лот уже присуждён' });
    const { rowCount } = await fastify.pool.query(
      `DELETE FROM supplier_order_offers WHERE id = $1 AND order_id = $2`,
      [request.params.offerId, request.params.id],
    );
    if (!rowCount) return reply.status(404).send({ error: 'КП не найдено' });
    return { data: { ok: true } };
  });

  // ============================================================
  // POST /:id/award — зафиксировать поставщика (одна атомарная операция; И5).
  //   manual — по выбранному КП (сумму/поставщика берёт сервер из КП; только RUB).
  //   tender — по победителю площадки (сервер резолвит ставку/сумму из tender_results; тендер finished).
  // ============================================================
  fastify.post<{ Params: { id: string } }>('/:id/award', async (request, reply) => {
    const user = request.currentUser;
    const body = awardSchema.parse(request.body);
    const client = await fastify.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM supplier_orders WHERE id = $1 AND kind = 'sourcing' FOR UPDATE`,
        [request.params.id],
      );
      const lot = rows[0];
      if (!lot) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Лот не найден' }); }
      if (lot.sourcing_status !== 'sourcing') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Присудить можно только лот в стадии закупки' });
      }
      if (body.expectedVersion != null && body.expectedVersion !== lot.row_version) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Лот изменён, обновите страницу', rowVersion: lot.row_version });
      }

      let supplierName: string;
      let supplierInn: string | null = null;
      let supplierId: string | null = null;
      let amount: number;
      let quoteId: string | null = null;

      if (body.source === 'manual') {
        if (lot.procurement_method !== 'manual') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Лот закупается через тендер' }); }
        if (!body.quoteId) { await client.query('ROLLBACK'); return reply.status(400).send({ error: 'Не выбрано КП' }); }
        const { rows: oRows } = await client.query(
          `SELECT * FROM supplier_order_offers WHERE id = $1 AND order_id = $2`,
          [body.quoteId, lot.id],
        );
        const offer = oRows[0];
        if (!offer) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'КП не найдено' }); }
        if (offer.currency !== 'RUB') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Валюта КП не поддерживается (только RUB)' }); }
        supplierName = offer.supplier_name;
        supplierInn = offer.supplier_inn;
        supplierId = offer.supplier_id;
        amount = Number(offer.amount);
        quoteId = offer.id;
      } else {
        // tender: победитель определён площадкой; сервер резолвит ставку из сохранённых результатов.
        if (lot.procurement_method !== 'tender') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Лот закупается по почте' }); }
        if (lot.tender_status !== 'finished') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Тендер ещё не завершён' }); }
        const results = lot.tender_results as {
          participants?: { id: string; name: string; inn?: string | null }[];
          bids?: { participant_id: string; amount: number; currency?: string | null }[];
          winner?: { participant_id: string; bid_index?: number | null } | null;
        } | null;
        const portalWinner = results?.winner?.participant_id;
        if (!portalWinner) { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Победитель тендера не определён' }); }
        // Подтверждаем именно победителя площадки (клиент не может назначить произвольного участника).
        if (body.winnerParticipantId && body.winnerParticipantId !== portalWinner) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Победителя тендера определяет площадка' });
        }
        const participant = results?.participants?.find((p) => p.id === portalWinner);
        const bidIdx = results?.winner?.bid_index;
        const bid = (bidIdx != null && results?.bids?.[bidIdx]?.participant_id === portalWinner)
          ? results.bids[bidIdx]
          : results?.bids?.filter((b) => b.participant_id === portalWinner).sort((a, b) => a.amount - b.amount)[0];
        if (!participant || !bid) { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Ставка победителя не найдена в результатах' }); }
        if (bid.currency && bid.currency !== 'RUB') { await client.query('ROLLBACK'); return reply.status(409).send({ error: 'Валюта ставки не поддерживается (только RUB)' }); }
        supplierName = participant.name;
        supplierInn = participant.inn ?? null;
        amount = Number(bid.amount);
      }

      await client.query(
        `UPDATE supplier_orders
            SET sourcing_status = 'awarded', supplier_name = $2, supplier_inn = $3, supplier_id = $4,
                amount = $5, award_source = $6, awarded_quote_id = $7, awarded_at = now(), awarded_by = $8,
                row_version = row_version + 1, updated_at = now()
          WHERE id = $1`,
        [lot.id, supplierName, supplierInn, supplierId, amount, body.source, quoteId, user.id],
      );
      await appendOrderAudit(client, {
        orderId: lot.id, action: 'awarded', userId: user.id,
        changes: { source: body.source, supplierName, amount }, projectId: lot.project_id,
      });
      const { rows: reqRows } = await client.query('SELECT DISTINCT request_id FROM supplier_order_items WHERE order_id = $1', [lot.id]);
      for (const r of reqRows) if (r.request_id) await recalcRequestStatus(client, r.request_id, user.id);
      await client.query('COMMIT');
      return { data: { id: lot.id, sourcingStatus: 'awarded', supplierName, amount } };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ============================================================
  // GET / — реестр лотов (фильтр по объекту/стадии, пагинация)
  // ============================================================
  fastify.get<{ Querystring: { projectId?: string; status?: string; limit?: string; offset?: string } }>('/', async (request) => {
    const q = request.query;
    const values: unknown[] = [];
    const where: string[] = [`so.kind = 'sourcing'`];
    if (q.projectId) { values.push(q.projectId); where.push(`so.project_id = $${values.length}`); }
    if (q.status) {
      const st = q.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (st.length) { values.push(st); where.push(`so.sourcing_status = ANY($${values.length}::text[])`); }
    }
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const offset = Math.max(Number(q.offset) || 0, 0);
    values.push(limit, offset);

    const { rows } = await fastify.pool.query(
      `SELECT so.id, so.order_no, so.title, so.project_id, so.project_name,
              so.sourcing_status, so.procurement_method, so.supplier_name, so.supplier_inn, so.amount,
              so.tender_status, so.tender_url, so.tender_sync_status, so.awarded_at, so.created_at, so.row_version,
              (SELECT count(*) FROM supplier_order_items i WHERE i.order_id = so.id) AS items_count,
              (SELECT count(DISTINCT i.request_id) FROM supplier_order_items i WHERE i.order_id = so.id) AS requests_count,
              count(*) OVER() AS total
         FROM supplier_orders so
        WHERE ${where.join(' AND ')}
        ORDER BY so.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const total = rows[0] ? Number(rows[0].total) : 0;
    return { data: rows, meta: { total } };
  });

  // ============================================================
  // GET /by-request/:requestId — лоты, в которые вошли позиции заявки + сводка покрытия
  //   (для секции «Закупочные лоты» в карточке su10-заявки).
  // ============================================================
  fastify.get<{ Params: { requestId: string } }>('/by-request/:requestId', async (request) => {
    const rid = request.params.requestId;
    const [lots, cov, mats] = await Promise.all([
      fastify.pool.query(
        `SELECT so.id, so.order_no, so.title, so.sourcing_status, so.procurement_method, so.tender_status,
                so.tender_url, so.supplier_name, so.amount,
                COALESCE(SUM(soi.quantity), 0)::numeric AS qty
           FROM supplier_orders so
           JOIN supplier_order_items soi ON soi.order_id = so.id AND soi.request_id = $1
          WHERE so.kind = 'sourcing'
          GROUP BY so.id
          ORDER BY so.order_no`,
        [rid],
      ),
      fastify.pool.query(
        `SELECT
           (SELECT project_id FROM material_requests WHERE id = $1) AS project_id,
           (SELECT COALESCE(SUM(quantity),0) FROM material_request_items WHERE request_id = $1)::numeric AS requested,
           (SELECT COALESCE(SUM(soi.quantity),0) FROM supplier_order_items soi
              JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status <> 'cancelled'
             WHERE soi.request_id = $1)::numeric AS placed,
           (SELECT COALESCE(SUM(soi.quantity),0) FROM supplier_order_items soi
              JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status = 'awarded'
             WHERE soi.request_id = $1)::numeric AS awarded`,
        [rid],
      ),
      // Позиции самой заявки в формате свода (для «Сформировать лот» прямо из карточки).
      fastify.pool.query(
        `SELECT mri.id AS request_item_id, mri.request_id, mr.request_no,
                mri.cost_type_id, ct.name AS cost_type_name,
                cc.id AS category_id, cc.name AS category_name,
                cc.sort_order AS category_sort, ct.sort_order AS cost_type_sort,
                mri.material_id, mri.material_name, mri.unit, mri.agg_key,
                mri.quantity::numeric AS requested, COALESCE(placed.qty, 0)::numeric AS ordered,
                mr.contractor_id, mr.contractor_name
           FROM material_request_items mri
           JOIN material_requests mr ON mr.id = mri.request_id
                AND mr.request_type = 'su10' AND mr.status <> 'cancelled'
           LEFT JOIN cost_types ct ON ct.id = mri.cost_type_id
           LEFT JOIN cost_categories cc ON cc.id = ct.category_id
           LEFT JOIN (
             SELECT soi.request_item_id, SUM(soi.quantity) AS qty
               FROM supplier_order_items soi
               JOIN supplier_orders so ON so.id = soi.order_id AND so.sourcing_status <> 'cancelled'
              GROUP BY soi.request_item_id
           ) placed ON placed.request_item_id = mri.id
          WHERE mri.request_id = $1
          ORDER BY cc.sort_order NULLS LAST, ct.sort_order NULLS LAST, mri.material_name`,
        [rid],
      ),
    ]);
    const { project_id, ...coverage } = cov.rows[0] ?? {};
    const materials = mats.rows.map((r) => ({ ...r, remaining: Number(r.requested) - Number(r.ordered) }));
    return { data: { lots: lots.rows, coverage, projectId: project_id ?? null, materials } };
  });

  // ============================================================
  // GET /:id — карточка лота (позиции, заявки-источники, КП, результаты тендера)
  // ============================================================
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { rows } = await fastify.pool.query(
      `SELECT * FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
      [request.params.id],
    );
    const lot = rows[0];
    if (!lot) return reply.status(404).send({ error: 'Лот не найден' });

    const [items, sources, offers] = await Promise.all([
      fastify.pool.query(
        `SELECT id, request_id, request_item_id, material_id, material_name, unit, quantity,
                contractor_id, contractor_name, request_no, cost_type_name, cost_category_name
           FROM supplier_order_items WHERE order_id = $1 ORDER BY cost_category_name, cost_type_name, material_name`,
        [lot.id],
      ),
      fastify.pool.query(
        `SELECT DISTINCT i.request_id, i.request_no, mr.contractor_name, mr.status
           FROM supplier_order_items i JOIN material_requests mr ON mr.id = i.request_id
          WHERE i.order_id = $1`,
        [lot.id],
      ),
      fastify.pool.query(
        `SELECT id, supplier_id, supplier_name, supplier_inn, amount, currency, terms, note, file_id, submitted_at, created_at
           FROM supplier_order_offers WHERE order_id = $1 ORDER BY amount`,
        [lot.id],
      ),
    ]);
    return { data: { ...lot, items: items.rows, sources: sources.rows, offers: offers.rows } };
  });
}
