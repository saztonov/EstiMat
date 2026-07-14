/**
 * Зоны ответственности закупок (справочник «Закупки», procurement_category_responsibles).
 * Право распределять материалы категорий в заказы поставщику:
 *   - admin — всегда;
 *   - иначе для КАЖДОЙ категории пользователь должен быть её ответственным;
 *   - fallback: категория без единого ответственного доступна всем внутренним ролям
 *     (иначе пустой справочник заблокировал бы всех, кроме admin);
 *   - позиция без категории (null) — только admin (её нельзя авто-маршрутизировать).
 */
import type { Pool, PoolClient } from 'pg';
import type { Role } from '@estimat/shared';

type Db = Pool | PoolClient;

export type CategoryAccess = { ok: true } | { ok: false; reason: string };

export async function assertCategoryAccess(
  db: Db,
  userId: string,
  role: Role,
  categoryIds: (string | null)[],
): Promise<CategoryAccess> {
  if (role === 'admin') return { ok: true };
  if (categoryIds.some((c) => c == null)) {
    return { ok: false, reason: 'Материалы без категории распределяет только администратор' };
  }
  const unique = [...new Set(categoryIds as string[])];
  if (unique.length === 0) return { ok: true };

  const { rows } = await db.query(
    `SELECT category_id, bool_or(user_id = $2) AS is_mine
       FROM procurement_category_responsibles
      WHERE category_id = ANY($1::uuid[])
      GROUP BY category_id`,
    [unique, userId],
  );
  // Категории, присутствующие в выборке, имеют хотя бы одного ответственного; отсутствующие —
  // без ответственных (fallback: доступны). is_mine=false при наличии ответственных → запрет.
  const withResp = new Map<string, boolean>(
    (rows as { category_id: string; is_mine: boolean }[]).map((r) => [r.category_id, r.is_mine === true]),
  );
  for (const c of unique) {
    if (withResp.has(c) && !withResp.get(c)) {
      return { ok: false, reason: 'Материалы вне вашей зоны ответственности' };
    }
  }
  return { ok: true };
}
