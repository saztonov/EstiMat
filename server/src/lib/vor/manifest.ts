import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { VorContentFacets } from '@estimat/shared';
import {
  buildContentFacets,
} from '../estimate-export/index.js';
import {
  isSupportedSchemaVersion,
  type VorManifest,
} from '../estimate-export/vor-content.js';

// Построчный снимок ВОР (S3) и фасеты его содержимого. Живёт в lib, а не в роуте: снимок читают
// и реестр ВОР, и назначение подрядчика, и контекст заявки — импорт роутом из роута сделал бы
// зависимость «заявки → сметы» на ровном месте.

/** Прочитать объект S3 целиком в память (снимок и предпросмотр файла — небольшие, не стримим). */
export async function readObjectBuffer(fastify: FastifyInstance, key: string): Promise<Buffer> {
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

/** Строка ВОР в том виде, в каком её выбирают из БД для фасетов. */
export interface VorFacetsRow {
  id: string;
  content_facets: VorContentFacets | null;
  snapshot_key: string | null;
  snapshot_checksum: Buffer | null;
  content_schema_version: number;
}

export const EMPTY_FACETS: VorContentFacets = { locations: [], types: [] };

/**
 * Местоположения и типы строк ВОР (как было на момент выгрузки). Фасеты пишутся при создании; у
 * ВОР, созданных раньше, их нет — досчитываем из снимка при первом обращении и сохраняем, чтобы
 * следующий раз обошёлся без похода в S3. ВОР без пригодного снимка (легаси) остаётся без фасетов:
 * взять их неоткуда, и в карте его просто нет.
 */
export async function ensureVorFacets(
  fastify: FastifyInstance,
  rows: VorFacetsRow[],
): Promise<Map<string, VorContentFacets>> {
  const byVor = new Map<string, VorContentFacets>();
  for (const r of rows) {
    if (r.content_facets) {
      byVor.set(r.id, r.content_facets);
      continue;
    }
    const manifest = await loadVorManifest(fastify, {
      snapshotKey: r.snapshot_key,
      snapshotChecksum: r.snapshot_checksum,
      version: r.content_schema_version,
    });
    if (!manifest) continue;
    const facets = buildContentFacets(manifest);
    byVor.set(r.id, facets);
    await fastify.pool.query(
      'UPDATE estimate_vors SET content_facets = $2::jsonb WHERE id = $1 AND content_facets IS NULL',
      [r.id, JSON.stringify(facets)],
    );
  }
  return byVor;
}
