/**
 * Применение выбранных позиций к смете. Запускается роутом /apply внутри одной
 * транзакции. КЛИЕНТУ НЕ ДОВЕРЯЕМ: имя/единицу/цену/cost_type берём из БД по
 * (source, catalogId); клиент передал лишь ссылки, количество и флаги.
 *
 * Все позиции добавляются как source='ai', needs_review=true (на подтверждение),
 * с трассировкой ai_job_id (аудит) и ai_chat_id (сессия). Дубли без override
 * пропускаются. Действие логируется в ai_jobs (source_kind='catalog_query').
 */
import type { ApplyItem } from '@estimat/shared';
import { findWorkDuplicate, findMaterialDuplicate } from './duplicates.js';
import { getTypicalMaterials } from './typical.js';
import type { Queryable } from './types.js';

export interface ApplyContext {
  estimateId: string;
  chatId: string;
  userId: string;
  model: string | null;
  /** Текст задачи пользователя — в source_snippet и ai_jobs.input. */
  prompt: string;
}

export interface ApplyResultInternal {
  aiJobId: string;
  added: { works: number; materials: number };
  /** id добавленных работ (для навигации «перейти к позиции» на фронте). */
  addedItemIds: string[];
  skipped: { catalogId: string; reason: string }[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function nextWorkSort(db: Queryable, estimateId: string, costTypeId: string | null): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM estimate_items
     WHERE estimate_id = $1 AND cost_type_id IS NOT DISTINCT FROM $2`,
    [estimateId, costTypeId],
  );
  return num(rows[0]?.n);
}

async function nextMaterialSort(db: Queryable, itemId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM estimate_materials WHERE item_id = $1`,
    [itemId],
  );
  return num(rows[0]?.n);
}

interface WorkCanonical {
  name: string;
  unit: string | null;
  price: number;
  costTypeId: string | null;
  applyRateId: string | null;
}

async function resolveWork(db: Queryable, source: string, catalogId: string): Promise<WorkCanonical | null> {
  if (source === 'v2') {
    const { rows } = await db.query(
      `SELECT rv.name, rv.unit, rv.cost_type_id, rv.legacy_rate_id,
              COALESCE(NULLIF(rv.price, 0), lr.price) AS price
       FROM rates_v2 rv LEFT JOIN rates lr ON rv.legacy_rate_id = lr.id
       WHERE rv.id = $1 AND rv.is_active = true`,
      [catalogId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { name: r.name, unit: r.unit, price: num(r.price), costTypeId: r.cost_type_id ?? null, applyRateId: r.legacy_rate_id ?? null };
  }
  const { rows } = await db.query(
    `SELECT name, unit, price, cost_type_id, id FROM rates WHERE id = $1 AND is_active = true`,
    [catalogId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { name: r.name, unit: r.unit, price: num(r.price), costTypeId: r.cost_type_id ?? null, applyRateId: r.id };
}

interface MaterialCanonical {
  name: string;
  unit: string | null;
  price: number;
  applyMaterialId: string | null;
}

async function resolveMaterial(db: Queryable, source: string, catalogId: string): Promise<MaterialCanonical | null> {
  if (source === 'v2') {
    const { rows } = await db.query(
      `SELECT mv.name, mv.unit, mv.legacy_material_id, mc.unit_price AS price
       FROM materials_v2 mv LEFT JOIN material_catalog mc ON mc.id = mv.legacy_material_id
       WHERE mv.id = $1 AND mv.is_active = true`,
      [catalogId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { name: r.name, unit: r.unit, price: num(r.price), applyMaterialId: r.legacy_material_id ?? null };
  }
  const { rows } = await db.query(
    `SELECT name, unit, unit_price, id FROM material_catalog WHERE id = $1 AND is_active = true`,
    [catalogId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { name: r.name, unit: r.unit, price: num(r.unit_price), applyMaterialId: r.id };
}

async function insertMaterialRow(
  db: Queryable,
  itemId: string,
  ctx: ApplyContext,
  aiJobId: string,
  m: { materialId: string | null; name: string; unit: string | null; price: number; quantity: number; sort: number },
): Promise<void> {
  await db.query(
    `INSERT INTO estimate_materials
       (item_id, estimate_id, material_id, description, quantity, unit, unit_price, sort_order, status,
        source, ai_job_id, ai_chat_id, needs_review, source_snippet)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'suggested', 'ai', $9, $10, true, $11)`,
    [itemId, ctx.estimateId, m.materialId, m.name, m.quantity, m.unit, m.price, m.sort, aiJobId, ctx.chatId, ctx.prompt],
  );
}

export async function applySelected(
  db: Queryable,
  ctx: ApplyContext,
  items: ApplyItem[],
  override: boolean,
): Promise<ApplyResultInternal> {
  const { rows: jobRows } = await db.query(
    `INSERT INTO ai_jobs (estimate_id, source_kind, input, status, model, created_by)
     VALUES ($1, 'catalog_query', $2::jsonb, 'applied', $3, $4) RETURNING id`,
    [ctx.estimateId, JSON.stringify({ query: ctx.prompt }), ctx.model, ctx.userId],
  );
  const aiJobId: string = jobRows[0].id;

  const skipped: { catalogId: string; reason: string }[] = [];
  const applied: unknown[] = [];
  const addedItemIds: string[] = [];
  let works = 0;
  let materials = 0;

  for (const item of items) {
    if (item.kind === 'work') {
      const canon = await resolveWork(db, item.source, item.catalogId);
      if (!canon) {
        skipped.push({ catalogId: item.catalogId, reason: 'not_found' });
        continue;
      }
      const dup = await findWorkDuplicate(db, ctx.estimateId, canon.applyRateId, canon.name);
      if (dup && !override) {
        skipped.push({ catalogId: item.catalogId, reason: 'duplicate' });
        continue;
      }
      const sort = await nextWorkSort(db, ctx.estimateId, canon.costTypeId);
      const { rows } = await db.query(
        `INSERT INTO estimate_items
           (estimate_id, cost_type_id, rate_id, description, quantity, unit, unit_price, sort_order,
            source, ai_job_id, ai_chat_id, needs_review, source_snippet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ai', $9, $10, true, $11)
         RETURNING id`,
        [ctx.estimateId, canon.costTypeId, canon.applyRateId, canon.name, item.quantity, canon.unit, canon.price, sort, aiJobId, ctx.chatId, ctx.prompt],
      );
      const itemId: string = rows[0].id;
      works++;
      addedItemIds.push(itemId);
      applied.push({ kind: 'work', source: item.source, catalogId: item.catalogId, itemId, rateId: canon.applyRateId });

      if (item.addTypicalMaterials) {
        const typ = await getTypicalMaterials(db, item.source, item.catalogId);
        let ms = 0;
        for (const t of typ) {
          await insertMaterialRow(db, itemId, ctx, aiJobId, {
            materialId: t.applyMaterialId,
            name: t.name,
            unit: t.unit,
            price: t.price,
            quantity: Math.round(item.quantity * t.qtyRatio * 10000) / 10000,
            sort: ms++,
          });
          materials++;
        }
      }
    } else {
      // material к существующей работе сметы
      const owns = await db.query(
        `SELECT 1 FROM estimate_items WHERE id = $1 AND estimate_id = $2 LIMIT 1`,
        [item.targetItemId, ctx.estimateId],
      );
      if (!owns.rows.length) {
        skipped.push({ catalogId: item.catalogId, reason: 'target_not_in_estimate' });
        continue;
      }
      const canon = await resolveMaterial(db, item.source, item.catalogId);
      if (!canon) {
        skipped.push({ catalogId: item.catalogId, reason: 'not_found' });
        continue;
      }
      const dup = await findMaterialDuplicate(db, ctx.estimateId, canon.applyMaterialId, canon.name);
      if (dup && !override) {
        skipped.push({ catalogId: item.catalogId, reason: 'duplicate' });
        continue;
      }
      const sort = await nextMaterialSort(db, item.targetItemId);
      await insertMaterialRow(db, item.targetItemId, ctx, aiJobId, {
        materialId: canon.applyMaterialId,
        name: canon.name,
        unit: canon.unit,
        price: canon.price,
        quantity: item.quantity,
        sort,
      });
      materials++;
      addedItemIds.push(item.targetItemId);
      applied.push({ kind: 'material', source: item.source, catalogId: item.catalogId, targetItemId: item.targetItemId });
    }
  }

  await db.query(
    `UPDATE ai_jobs SET result = $2::jsonb, status = 'applied' WHERE id = $1`,
    [aiJobId, JSON.stringify({ prompt: ctx.prompt, applied, skipped, counts: { works, materials } })],
  );

  return { aiJobId, added: { works, materials }, addedItemIds: [...new Set(addedItemIds)], skipped };
}

/**
 * Копирование раздела (вида затрат) из доступной сметы-источника в текущую.
 * Работы и их материалы → source='ai', needs_review=true. Доступ к источнику
 * проверяется роутом до вызова.
 */
export async function applySection(
  db: Queryable,
  ctx: ApplyContext,
  sourceEstimateId: string,
  costTypeId: string,
  override: boolean,
  maxRows = 100,
): Promise<ApplyResultInternal> {
  const { rows: jobRows } = await db.query(
    `INSERT INTO ai_jobs (estimate_id, source_kind, input, status, model, created_by)
     VALUES ($1, 'catalog_query', $2::jsonb, 'applied', $3, $4) RETURNING id`,
    [ctx.estimateId, JSON.stringify({ query: ctx.prompt, sourceEstimateId, costTypeId }), ctx.model, ctx.userId],
  );
  const aiJobId: string = jobRows[0].id;

  const { rows: srcItems } = await db.query(
    `SELECT id, rate_id, description, quantity, unit, unit_price
     FROM estimate_items
     WHERE estimate_id = $1 AND cost_type_id = $2
     ORDER BY sort_order, created_at
     LIMIT $3`,
    [sourceEstimateId, costTypeId, maxRows],
  );

  const skipped: { catalogId: string; reason: string }[] = [];
  const addedItemIds: string[] = [];
  let works = 0;
  let materials = 0;
  let sort = await nextWorkSort(db, ctx.estimateId, costTypeId);

  for (const w of srcItems) {
    const dup = await findWorkDuplicate(db, ctx.estimateId, w.rate_id ?? null, w.description);
    if (dup && !override) {
      skipped.push({ catalogId: w.id, reason: 'duplicate' });
      continue;
    }
    const { rows } = await db.query(
      `INSERT INTO estimate_items
         (estimate_id, cost_type_id, rate_id, description, quantity, unit, unit_price, sort_order,
          source, ai_job_id, ai_chat_id, needs_review, source_snippet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ai', $9, $10, true, $11)
       RETURNING id`,
      [ctx.estimateId, costTypeId, w.rate_id ?? null, w.description, num(w.quantity), w.unit, num(w.unit_price), sort++, aiJobId, ctx.chatId, ctx.prompt],
    );
    const newItemId: string = rows[0].id;
    works++;
    addedItemIds.push(newItemId);

    const { rows: srcMats } = await db.query(
      `SELECT material_id, description, quantity, unit, unit_price
       FROM estimate_materials WHERE item_id = $1 ORDER BY sort_order, created_at`,
      [w.id],
    );
    let ms = 0;
    for (const m of srcMats) {
      await insertMaterialRow(db, newItemId, ctx, aiJobId, {
        materialId: m.material_id ?? null,
        name: m.description,
        unit: m.unit,
        price: num(m.unit_price),
        quantity: num(m.quantity),
        sort: ms++,
      });
      materials++;
    }
  }

  await db.query(`UPDATE ai_jobs SET result = $2::jsonb, status = 'applied' WHERE id = $1`, [
    aiJobId,
    JSON.stringify({ prompt: ctx.prompt, sourceEstimateId, costTypeId, counts: { works, materials }, skipped }),
  ]);

  return { aiJobId, added: { works, materials }, addedItemIds, skipped };
}
