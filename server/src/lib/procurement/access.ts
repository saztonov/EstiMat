/**
 * Зоны ответственности закупок: право вести заказ по материалам конкретных областей.
 *
 * Правила:
 *   - admin — всегда;
 *   - позиция без вида затрат (cost_type_id = null) — только admin: её нельзя авто-маршрутизировать;
 *   - fallback: область, где НЕ назначен никто ни на одном уровне (материал/вид/категория),
 *     доступна всем внутренним ролям — иначе пустой справочник заблокировал бы всех, кроме admin,
 *     а после перехода на уровень видов незаполненных областей заведомо много;
 *   - иначе доступ есть у назначенного И у его заместителя. Объединение, а не передача:
 *     отбирать доступ у человека на время отпуска операционно опасно (вышел раньше, работает
 *     из дома → блокировка и обращение в поддержку), а подмена нужна для маршрутизации и
 *     отображения, а не для запрета.
 *
 * Применяется ко ВСЕМ рабочим мутациям заказа, а не только к созданию: до 0071 проверка стояла
 * в одном месте, и правку состава, поставщиков и отправку на согласование мог делать любой
 * внутренний пользователь.
 */
import type { Pool, PoolClient } from 'pg';
import type { Role } from '@estimat/shared';
import { resolveResponsibles, scopeKey, type MaterialScopeKey } from './responsibles.js';

type Db = Pool | PoolClient;

export type CategoryAccess = { ok: true } | { ok: false; reason: string };

export async function assertOrderAccess(
  db: Db,
  userId: string,
  role: Role,
  scopes: MaterialScopeKey[],
): Promise<CategoryAccess> {
  if (role === 'admin') return { ok: true };
  if (scopes.some((s) => s.costTypeId == null)) {
    return { ok: false, reason: 'Материалы без вида затрат распределяет только администратор' };
  }
  if (scopes.length === 0) return { ok: true };

  const resolved = await resolveResponsibles(db, scopes);
  for (const s of scopes) {
    const r = resolved.get(scopeKey(s));
    // Никто не назначен ни на одном уровне — область свободна для всех внутренних ролей.
    if (!r || r.assignedUserId == null) continue;
    if (r.assignedUserId === userId || r.effectiveUserId === userId) continue;
    return { ok: false, reason: 'Материалы вне вашей зоны ответственности' };
  }
  return { ok: true };
}
