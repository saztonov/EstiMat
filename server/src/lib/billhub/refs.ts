/**
 * Кэш справочников BillHub (поставщики / условия отгрузки / типы документов) в таблице
 * billhub_ref_cache. Stale-while-revalidate: отдаём кэш сразу, при устаревании обновляем из
 * BillHub (если настроен). Форма заявки на оплату выбирает поставщика/условия из этих данных;
 * без кэша и без настройки формы работают только как черновик (submit заблокирован).
 */
import type { FastifyInstance } from 'fastify';
import { billhub, BillhubError } from './client.js';
import { config } from '../../config.js';

export type RefType = 'suppliers' | 'shipping' | 'document_types';
const FRESH_MS = 10 * 60_000;

async function fetchFromBillhub(refType: RefType): Promise<unknown[]> {
  if (refType === 'suppliers') return (await billhub.listSuppliers()).data;
  if (refType === 'shipping') return (await billhub.listShipping()).data;
  return (await billhub.listDocumentTypes()).data;
}

interface CacheRow {
  payload: unknown[];
  last_synced_at: string;
  fresh: boolean;
}

/** Возвращает справочник + признак настройки/свежести (для UI). */
export async function getRefs(
  fastify: FastifyInstance,
  refType: RefType,
): Promise<{ data: unknown[]; stale: boolean; configured: boolean }> {
  const cached = await fastify.pool.query<CacheRow>(
    `SELECT payload, last_synced_at, (last_synced_at > now() - ($2::text || ' milliseconds')::interval) AS fresh
       FROM billhub_ref_cache WHERE ref_type = $1`,
    [refType, FRESH_MS],
  );
  const row = cached.rows[0];
  const configured = config.billhub.configured;

  // Свежий кэш — отдаём сразу.
  if (row && row.fresh) return { data: row.payload, stale: false, configured };

  // Не настроено — отдаём что есть (возможно устаревшее/пустое).
  if (!configured) return { data: row?.payload ?? [], stale: true, configured };

  // Обновляем из BillHub; при ошибке — деградация на кэш.
  try {
    const data = await fetchFromBillhub(refType);
    await fastify.pool.query(
      `INSERT INTO billhub_ref_cache (ref_type, payload, last_synced_at)
       VALUES ($1, $2, now())
       ON CONFLICT (ref_type) DO UPDATE SET payload = EXCLUDED.payload, last_synced_at = now()`,
      [refType, JSON.stringify(data)],
    );
    return { data, stale: false, configured };
  } catch (e) {
    if (!(e instanceof BillhubError)) throw e;
    fastify.log.warn({ err: e.message, refType }, 'BillHub refs: обновление не удалось, отдаю кэш');
    return { data: row?.payload ?? [], stale: true, configured };
  }
}
