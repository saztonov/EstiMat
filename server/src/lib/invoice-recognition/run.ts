/**
 * Прогон распознавания счёта: файл из S3 → модель → разбор → сверка с заказом.
 *
 * Асинхронно и с блокировкой: вызов модели идёт 30–120 с, и прогон, прерванный деплоем, не должен
 * навсегда остаться в статусе 'running'. Запись самого счёта служит записью задания (см. 0080).
 *
 * Ни один сценарий отказа не мешает работе: счёт остаётся приложенным, реквизиты вводятся руками.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { recognizedInvoiceSchema, type RecognizedInvoice } from '@estimat/shared';
import { config } from '../../config.js';
import { resolveAiModel } from '../llm/settings.js';
import { loadLlmRuntime, resolveLlmEndpoint } from '../llm/endpoint.js';
import { resolvePrompt } from '../llm/prompts.js';
import { chatJsonOnce, LlmCallError } from '../llm/chat-json.js';
import { extractJson } from '../llm/json.js';
import { startLlmCall, markLlmCall, finishLlmCall } from '../llm/call-log.js';
import { prepareInvoiceDocument, UnsupportedDocumentError } from './prepare.js';
import { reconcileInvoice, type OrderSnapshot } from './reconcile.js';

/** Сколько держим блокировку без продления. */
const LOCK_TTL_MS = 5 * 60_000;
/** Бюджет вызова: одна полновесная попытка плюс повтор — счёт не та задача, ради которой стоит ждать дольше. */
const CALL_BUDGET_MS = 420_000;
/** Потолок попыток: после него счёт остаётся с ошибкой и кнопкой «повторить». */
const MAX_ATTEMPTS = 3;

const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** Пометить счёт неподдерживаемым — это не сбой, а понятное ограничение. */
async function markUnsupported(fastify: FastifyInstance, invoiceId: string, message: string) {
  await fastify.pool.query(
    `UPDATE supplier_order_invoices
        SET recognition_status = 'unsupported', recognition_error = $2, locked_by = NULL, locked_until = NULL
      WHERE id = $1`,
    [invoiceId, message],
  );
}

/** Снимок заказа для сверки: агрегаты материалов, цены, ставка и итог. */
async function loadOrderSnapshot(fastify: FastifyInstance, orderId: string): Promise<OrderSnapshot> {
  const { rows: lines } = await fastify.pool.query(
    `SELECT i.agg_key, MIN(i.material_name) AS name, i.unit,
            SUM(i.quantity)::numeric::text AS quantity,
            MAX(pl.unit_price)::text       AS unit_price
       FROM supplier_order_items i
       LEFT JOIN supplier_order_price_lines pl ON pl.order_id = i.order_id AND pl.agg_key = i.agg_key
      WHERE i.order_id = $1
      GROUP BY i.agg_key, i.unit`,
    [orderId],
  );
  const { rows: ord } = await fastify.pool.query(
    `SELECT amount::text AS amount, vat_rate FROM supplier_orders WHERE id = $1`,
    [orderId],
  );
  // vat_rate хранится кодом ('vat22'), сверке нужны проценты.
  const code: string | null = ord[0]?.vat_rate ?? null;
  const vatRatePercent = code === 'vat22' ? 22 : code === 'vat0' ? 0 : null;

  return {
    lines: lines.map((l) => ({
      aggKey: l.agg_key as string,
      name: l.name as string,
      unit: l.unit as string,
      quantity: l.quantity as string,
      unitPrice: (l.unit_price as string | null) ?? null,
    })),
    vatRatePercent,
    amount: (ord[0]?.amount as string | null) ?? null,
  };
}

/**
 * Распознать один счёт. Ошибки не бросает: любой отказ фиксируется в статусе счёта, иначе
 * необработанное исключение в фоне уронило бы процесс.
 */
export async function runInvoiceRecognition(fastify: FastifyInstance, invoiceId: string): Promise<void> {
  // Атомарный захват: параллельный процесс или повторный запуск не должны взять тот же счёт.
  const { rows: claimed } = await fastify.pool.query(
    `UPDATE supplier_order_invoices
        SET recognition_status = 'running', locked_by = $2,
            locked_until = now() + ($3 || ' milliseconds')::interval,
            attempts = attempts + 1, recognition_error = NULL
      WHERE id = $1
        AND recognition_status IN ('not_run','queued','failed','running')
        AND (locked_until IS NULL OR locked_until < now())
        AND attempts < $4
      RETURNING id, order_id, file_key, file_name, attempts`,
    [invoiceId, workerId, String(LOCK_TTL_MS), MAX_ATTEMPTS],
  );
  const inv = claimed[0];
  if (!inv) return; // уже занят другим прогоном, распознан или исчерпал попытки

  const heartbeat = setInterval(() => {
    fastify.pool
      .query(
        `UPDATE supplier_order_invoices SET locked_until = now() + ($2 || ' milliseconds')::interval
          WHERE id = $1 AND locked_by = $3`,
        [inv.id, String(LOCK_TTL_MS), workerId],
      )
      .catch(() => {});
  }, LOCK_TTL_MS / 3);

  let callId: string | null = null;
  try {
    if (!fastify.storage) {
      await markUnsupported(fastify, inv.id, 'Хранилище файлов не настроено — заполните реквизиты вручную');
      return;
    }

    const model = await resolveAiModel(fastify.pool);
    const runtime = await loadLlmRuntime(fastify.pool);
    const endpoint = resolveLlmEndpoint(model, runtime);
    if (!endpoint.enabled) {
      await markUnsupported(fastify, inv.id, 'Распознавание недоступно — заполните номер и дату счёта вручную');
      return;
    }
    // Локальная текстовая модель документы не читает: молча отправить ей PDF значило бы получить
    // уверенный выдуманный ответ.
    if (endpoint.isLmStudio) {
      await markUnsupported(fastify, inv.id, 'Локальная модель не читает документы — распознавание пропущено');
      return;
    }

    const obj = await fastify.storage.getObject(inv.file_key);
    const chunks: Buffer[] = [];
    for await (const chunk of obj.body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);

    let prepared;
    try {
      prepared = await prepareInvoiceDocument(buf, inv.file_name ?? 'invoice');
    } catch (e) {
      if (e instanceof UnsupportedDocumentError) {
        await markUnsupported(fastify, inv.id, e.userMessage);
        return;
      }
      throw e;
    }

    const system = await resolvePrompt(fastify.pool, 'invoice.extract');
    callId = await startLlmCall(fastify, {
      parent: { kind: 'invoice', supplierOrderInvoiceId: inv.id },
      kind: 'invoice.extract',
      attempt: Number(inv.attempts),
      model: endpoint.model,
      provider: endpoint.provider,
    });
    await markLlmCall(fastify, callId, 'in_progress');

    const controller = new AbortController();
    const res = await chatJsonOnce(
      {
        endpoint,
        signal: controller.signal,
        attemptTimeoutMs: config.ai.attemptTimeoutMs,
        callBudgetMs: CALL_BUDGET_MS,
        idempotencyKey: callId ?? undefined,
        extraBody: prepared.extraBody,
      },
      system,
      prepared.parts,
    );

    const raw = extractJson(res.content);
    const parsed = recognizedInvoiceSchema.safeParse(raw);
    if (!parsed.success) {
      await finishLlmCall(fastify, callId, {
        status: 'succeeded', parseStatus: 'failed',
        parseWarnings: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
        systemText: res.sentSystem, requestText: res.sentUser, responseText: res.content,
        finishReason: res.finishReason, usage: res.usage, attempts: res.attempts, durationMs: res.durationMs,
      });
      await fastify.pool.query(
        `UPDATE supplier_order_invoices
            SET recognition_status = 'failed', recognition_error = 'Не удалось разобрать ответ модели',
                locked_by = NULL, locked_until = NULL
          WHERE id = $1`,
        [inv.id],
      );
      return;
    }

    const recognized: RecognizedInvoice = parsed.data;
    const snapshot = await loadOrderSnapshot(fastify, inv.order_id);
    const match = reconcileInvoice(snapshot, recognized);

    // Реквизиты подставляем ТОЛЬКО в пустые поля: ручной ввод пользователя распознавание не
    // затирает никогда — человек знает документ лучше модели.
    await fastify.pool.query(
      `UPDATE supplier_order_invoices
          SET recognized = $2::jsonb, recognized_at = now(), recognition_model = $3,
              recognition_status = 'succeeded', recognition_error = NULL,
              match_result = $4::jsonb, match_status = $5,
              invoice_no   = COALESCE(invoice_no, $6),
              invoice_date = COALESCE(invoice_date, $7::date),
              amount       = COALESCE(amount, NULLIF($8, '')::numeric),
              vat_amount   = COALESCE(vat_amount, NULLIF($9, '')::numeric),
              supplier_name = COALESCE(supplier_name, $10),
              supplier_inn  = COALESCE(supplier_inn, $11),
              source = CASE WHEN source = 'manual' AND invoice_no IS NULL THEN 'llm' ELSE source END,
              locked_by = NULL, locked_until = NULL
        WHERE id = $1`,
      [
        inv.id,
        JSON.stringify(recognized),
        `${endpoint.provider}:${endpoint.model}`,
        JSON.stringify(match),
        match.status,
        recognized.invoiceNo ?? null,
        /^\d{4}-\d{2}-\d{2}$/.test(recognized.invoiceDate ?? '') ? recognized.invoiceDate : null,
        recognized.totals?.total ?? '',
        recognized.totals?.vat ?? '',
        recognized.supplier?.name ?? null,
        recognized.supplier?.inn ?? null,
      ],
    );

    await finishLlmCall(fastify, callId, {
      status: 'succeeded', parseStatus: match.warnings.length ? 'warnings' : 'ok',
      parseWarnings: match.warnings.slice(0, 10),
      systemText: res.sentSystem, requestText: res.sentUser, responseText: res.content,
      finishReason: res.finishReason, usage: res.usage, attempts: res.attempts, durationMs: res.durationMs,
    });
  } catch (e) {
    const err = e instanceof LlmCallError ? e : (e as Error);
    // Текст для человека, не стек: он попадёт прямо в карточку счёта.
    const message = err?.message ? String(err.message).slice(0, 500) : 'Ошибка распознавания';
    if (callId) {
      await finishLlmCall(fastify, callId, {
        status: 'failed', error: message,
        ...(e instanceof LlmCallError
          ? { systemText: e.sentSystem, requestText: e.sentUser, attempts: e.attempts, durationMs: e.durationMs }
          : {}),
      }).catch(() => {});
    }
    await fastify.pool
      .query(
        `UPDATE supplier_order_invoices
            SET recognition_status = 'failed', recognition_error = $2, locked_by = NULL, locked_until = NULL
          WHERE id = $1`,
        [invoiceId, message],
      )
      .catch(() => {});
    fastify.log.warn({ err, invoiceId }, 'invoice recognition failed');
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Вернуть в очередь прогоны, брошенные упавшим процессом: без этого счёт навсегда остался бы
 * «распознаётся», и повторить его было бы нечем.
 */
export async function requeueStaleRecognitions(fastify: FastifyInstance): Promise<void> {
  await fastify.pool
    .query(
      `UPDATE supplier_order_invoices
          SET recognition_status = 'queued', locked_by = NULL, locked_until = NULL
        WHERE recognition_status = 'running' AND locked_until IS NOT NULL AND locked_until < now()`,
    )
    .catch((err) => fastify.log.warn({ err }, 'invoice recognition: requeue failed'));
}
