/**
 * Поиск дублей позиции в текущей смете — чтобы пометить кандидата «уже в смете»
 * и не добавлять без явного override.
 */
import { norm } from '../extract/normalize.js';
import { nrmExpr } from './sql.js';
import type { Queryable } from './types.js';

/** Работа-дубль: по rate_id (если есть) либо по нормализованному наименованию. */
export async function findWorkDuplicate(
  db: Queryable,
  estimateId: string,
  rateId: string | null,
  name: string,
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT id FROM estimate_items
     WHERE estimate_id = $1
       AND (($2::uuid IS NOT NULL AND rate_id = $2) OR ${nrmExpr('description')} = $3)
     LIMIT 1`,
    [estimateId, rateId, norm(name)],
  );
  return rows[0]?.id ?? null;
}

/** Материал-дубль: по material_id (если есть) либо по нормализованному наименованию. */
export async function findMaterialDuplicate(
  db: Queryable,
  estimateId: string,
  materialId: string | null,
  name: string,
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT id FROM estimate_materials
     WHERE estimate_id = $1
       AND (($2::uuid IS NOT NULL AND material_id = $2) OR ${nrmExpr('description')} = $3)
     LIMIT 1`,
    [estimateId, materialId, norm(name)],
  );
  return rows[0]?.id ?? null;
}
