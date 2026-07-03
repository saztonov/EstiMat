/**
 * Общие примитивы детализации сметы, используемые несколькими роутами
 * (estimates, projects, contractors, estimate-export).
 */
import type { Pool, PoolClient } from 'pg';

// Канонический порядок работ (зона → этаж → тип помещения → категория/вид → sort_order).
// Требует алиасов ei/z/rt/cc/ct в вызывающем SQL.
export const ITEMS_CANONICAL_ORDER_BY =
  `z.sort_order NULLS LAST, ei.floor_from NULLS LAST, rt.sort_order NULLS LAST,
   cc.sort_order, ct.sort_order, ei.sort_order, ei.created_at`;

// Группировка строк по ключу за один проход (вместо .filter() внутри .map() — O(n×m)).
// Порядок внутри бакета = порядок входного массива (его задаёт ORDER BY в SQL).
export function bucketBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return map;
}

// projectId сметы (для payload события и денормализации в журнал).
// Принимает и Pool, и PoolClient (вызывается в т.ч. внутри транзакций).
export async function loadProjectId(
  db: Pick<Pool | PoolClient, 'query'>,
  estimateId: string,
): Promise<string | null> {
  const { rows } = await db.query('SELECT project_id FROM estimates WHERE id = $1', [estimateId]);
  return rows[0]?.project_id ?? null;
}
