import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import {
  integrationEventSchema,
  type IntegrationEventInput,
  PAYMENT_REQUEST_STATUS_LABELS,
  type PaymentRequestStatus,
} from '@estimat/shared';
import { authenticateService } from '../../middleware/authenticateService.js';

// Входящий канал BillHub → EstiMat: приём versioned snapshot-событий по заявкам на оплату.
// Идемпотентность — таблица integration_inbox (event_id). Порядок — применяем snapshot только
// если aggregate_version новее last_bh_version. Всё в одной транзакции: inbox + проекция +
// история + уведомления. Аутентификация — сервисный Api-Key.

function hashEvent(ev: IntegrationEventInput): string {
  // Канонический хэш содержательной части (без транспортных полей) для детекта конфликта event_id.
  return createHash('sha256')
    .update(JSON.stringify({ type: ev.type, v: ev.aggregateVersion, s: ev.snapshot }))
    .digest('hex');
}

function notificationText(ev: IntegrationEventInput, number: string | null): { title: string; body: string } {
  const num = number ? `Заявка на оплату ${number}` : 'Заявка на оплату';
  const s = ev.snapshot;
  switch (ev.type) {
    case 'payment_request.workflow_changed': {
      if (s.statusCode === 'revision') {
        return { title: `${num}: возврат на доработку`, body: s.revisionComment || 'Требуется доработка в BillHub.' };
      }
      const label = s.statusCode
        ? PAYMENT_REQUEST_STATUS_LABELS[s.statusCode as PaymentRequestStatus] ?? s.statusCode
        : 'статус изменён';
      return { title: `${num}: ${label}`, body: '' };
    }
    case 'payment_request.document_attached':
      return { title: `${num}: прикреплён документ`, body: s.documents?.[0]?.fileName ?? '' };
    case 'payment_request.rp_changed':
      return { title: `${num}: распределительное письмо ${s.rpNumber ?? ''}`.trim(), body: '' };
    case 'payment_request.rp_unlinked':
      return { title: `${num}: РП отвязано`, body: '' };
    case 'payment_request.payment_summary_changed': {
      const paid = s.paidStatus === 'paid' ? 'оплачена' : s.paidStatus === 'partially_paid' ? 'частично оплачена' : 'оплата обновлена';
      return { title: `${num}: ${paid}`, body: '' };
    }
    default:
      return { title: num, body: '' };
  }
}

export default async function integrationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticateService);

  // Приём события BillHub. Отдельный rate-limit — по IP внешней системы, не мешает браузерным.
  fastify.post(
    '/events',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const ev = integrationEventSchema.parse(request.body);
      const payloadHash = hashEvent(ev);
      const s = ev.snapshot;

      const client = await fastify.pool.connect();
      try {
        await client.query('BEGIN');

        // Находим локальную заявку по external_ref (блокируем строку от гонок проекций).
        const prRes = await client.query(
          `SELECT id, contractor_id, last_bh_version, bh_request_id, bh_request_number
             FROM payment_requests WHERE external_ref = $1 FOR UPDATE`,
          [ev.externalRef],
        );
        const pr = prRes.rows[0];
        if (!pr) {
          // Событие пришло раньше, чем заявка появилась (webhook раньше ответа submit) —
          // просим повторить позже; inbox НЕ фиксируем, чтобы событие не потерялось.
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Заявка не найдена, повторите позже' });
        }
        if (ev.bhRequestId && pr.bh_request_id && ev.bhRequestId !== pr.bh_request_id) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'Несоответствие идентификатора заявки BillHub' });
        }

        // Идемпотентность приёма.
        const ins = await client.query(
          `INSERT INTO integration_inbox
             (event_id, event_type, external_ref, bh_request_id, aggregate_version, payload_hash, processed_at, result)
           VALUES ($1,$2,$3,$4,$5,$6, now(), 'applied')
           ON CONFLICT (event_id) DO NOTHING
           RETURNING id`,
          [ev.eventId, ev.type, ev.externalRef, ev.bhRequestId ?? null, ev.aggregateVersion, payloadHash],
        );
        if (ins.rowCount === 0) {
          const existing = await client.query(
            `SELECT payload_hash FROM integration_inbox WHERE event_id = $1`,
            [ev.eventId],
          );
          await client.query('ROLLBACK');
          if (existing.rows[0]?.payload_hash !== payloadHash) {
            return reply.status(409).send({ error: 'Конфликт: событие с тем же id и другим телом' });
          }
          return { data: { status: 'duplicate' } };
        }

        // Применяем проекцию только если версия новее (защита от переупорядочивания событий).
        const applied = ev.aggregateVersion > pr.last_bh_version;
        if (applied) {
          const actionRequired = s.statusCode === 'revision' ? true : Boolean(s.actionRequired);
          // URL заявки уйдёт в href на клиенте — храним только http(s) (защита от javascript:-XSS).
          const safeUrl = s.requestUrl && /^https?:\/\//i.test(s.requestUrl) ? s.requestUrl : null;
          // Событие несёт ПОЛНЫЙ snapshot проекции → изменяемые поля применяем как replace
          // (null очищает: напр. rp_unlinked обнуляет rpNumber, снятие доработки — revisionComment).
          // COALESCE оставляем только для идентичности (номер/URL заявки — set-once) и total_paid (NOT NULL).
          await client.query(
            `UPDATE payment_requests SET
               status_code       = $2,
               action_required   = $3,
               revision_comment  = $4,
               bh_request_number = COALESCE($5, bh_request_number),
               bh_request_url    = COALESCE($6, bh_request_url),
               rp_number         = $7,
               rp_date           = $8::date,
               paid_status       = $9,
               total_paid        = COALESCE($10, total_paid),
               last_payment_date = $11::date,
               last_bh_version   = $12
             WHERE id = $1`,
            [
              pr.id,
              s.statusCode ?? null,
              actionRequired,
              s.revisionComment ?? null,
              s.requestNumber ?? null,
              safeUrl,
              s.rpNumber ?? null,
              s.rpDate ?? null,
              s.paidStatus ?? null,
              s.totalPaid ?? null,
              s.lastPaymentDate ?? null,
              ev.aggregateVersion,
            ],
          );
        }

        // История события (для карточки/аудита).
        await client.query(
          `INSERT INTO payment_request_history (payment_request_id, event_type, aggregate_version, detail)
           VALUES ($1, $2, $3, $4)`,
          [pr.id, ev.type, ev.aggregateVersion, JSON.stringify(s)],
        );

        // Уведомления всем активным пользователям организации подрядчика (идемпотентно).
        const number = s.requestNumber ?? pr.bh_request_number ?? null;
        const { title, body } = notificationText(ev, number);
        await client.query(
          `INSERT INTO notifications (user_id, org_id, type, title, body, payment_request_id, event_id)
           SELECT u.id, $1, $2, $3, $4, $5, $6
             FROM users u
            WHERE u.org_id = $1 AND u.is_active = true
           ON CONFLICT (event_id, user_id) DO NOTHING`,
          [pr.contractor_id, ev.type, title, body, pr.id, ev.eventId],
        );

        await client.query('COMMIT');
        return { data: { status: applied ? 'applied' : 'ignored_stale' } };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );
}
