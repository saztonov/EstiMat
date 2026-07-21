/**
 * Зоны ответственности закупок: право вести заказ поставщику.
 *
 * ОДИН предикат на весь контур. До 1.13 право считалось в трёх несогласованных видах: общая
 * проверка зоны (стояла ровно в одной мутации из тринадцати), «только создатель или admin»
 * (три маршрута) и отдельная копия внутри отправки на согласование. Менеджер, назначенный
 * ответственным, при этом не мог тронуть чужой заказ, а инженер вне зоны мог отменить любой.
 *
 * Правила:
 *   - admin и manager — всегда: они назначают ответственных и подтверждают поставщика, значит
 *     обязаны иметь возможность вмешаться в любой заказ;
 *   - позиция без вида затрат — только admin: её нельзя авто-маршрутизировать;
 *   - область, где не назначен НИКТО ни на одном уровне, доступна всем внутренним ролям — иначе
 *     пустой справочник заблокировал бы всех, кроме admin;
 *   - иначе доступ есть у назначенного И у его заместителя. Объединение, а не передача: отбирать
 *     доступ на время отпуска операционно опасно (вышел раньше, работает из дома → блокировка),
 *     а подмена нужна для маршрутизации и отображения, а не для запрета;
 *   - заказ БЕЗ позиций областей не имеет вовсе — его ведёт создатель (плюс admin/manager).
 *     Без этого правила чужой черновик оставался бы открыт всем: пустой список областей
 *     проходит цикл проверки насквозь.
 *
 * Контрактный список: подрядчики сюда не доходят — роутер закрыт requireRole на уровне плагина.
 */
import type { Pool, PoolClient } from 'pg';
import type { Role } from '@estimat/shared';
import { resolveResponsibles, scopeKey, type MaterialScopeKey } from './responsibles.js';

type Db = Pool | PoolClient;

export type CategoryAccess = { ok: true } | { ok: false; reason: string };

/** Роли, которые ведут любой заказ независимо от зон. */
const OVERRIDE_ROLES: ReadonlySet<Role> = new Set<Role>(['admin', 'manager']);

/** Что резолвер сообщил про область: кто назначен и кто фактически отвечает сегодня. */
export interface ScopeVerdict {
  assignedUserId: string | null;
  effectiveUserId: string | null;
}

/**
 * Решающее правило — БЕЗ обращений к БД, чтобы его можно было проверить тестами целиком.
 * Всё, что ходит в базу (загрузка областей и резолв ответственных), лежит в функциях ниже и
 * только подаёт сюда данные. Именно здесь живут два правила, которые легко потерять: пустой
 * заказ доступен создателю, а область без назначений — всем внутренним ролям.
 */
export function decideOrderAccess(input: {
  role: Role;
  userId: string;
  /** null — заказ не загружался (путь создания), проверка пустого заказа не применяется. */
  createdBy?: string | null;
  verdicts: ScopeVerdict[];
  /** true, если среди областей есть позиция без вида затрат. */
  hasScopeWithoutCostType: boolean;
  /** true, если у ЗАКАЗА нет ни одной позиции (а не «нечего заказывать»). */
  isEmptyOrder?: boolean;
}): CategoryAccess {
  if (OVERRIDE_ROLES.has(input.role)) return { ok: true };
  if (input.hasScopeWithoutCostType) {
    return { ok: false, reason: 'Материалы без вида затрат распределяет только администратор' };
  }
  if (input.isEmptyOrder) {
    return input.createdBy === input.userId
      ? { ok: true }
      : { ok: false, reason: 'Пустой заказ доступен только его создателю' };
  }
  for (const v of input.verdicts) {
    if (v.assignedUserId == null) continue;  // область свободна
    if (v.assignedUserId === input.userId || v.effectiveUserId === input.userId) continue;
    return { ok: false, reason: 'Материалы вне вашей зоны ответственности' };
  }
  return { ok: true };
}

/**
 * Проверка по явному списку областей — путь СОЗДАНИЯ заказа, где позиций ещё нет и области
 * приходят из выбранных строк свода.
 */
export async function assertOrderAccess(
  db: Db,
  userId: string,
  role: Role,
  scopes: MaterialScopeKey[],
): Promise<CategoryAccess> {
  if (OVERRIDE_ROLES.has(role)) return { ok: true };
  const hasScopeWithoutCostType = scopes.some((s) => s.costTypeId == null);
  // Пустой список здесь означает «нечего заказывать», а не «заказ пуст»: у создания областей
  // не бывает ноль. Правило пустого ЗАКАЗА живёт в assertOrderAccessForOrder.
  const resolved = hasScopeWithoutCostType || scopes.length === 0
    ? new Map()
    : await resolveResponsibles(db, scopes);

  return decideOrderAccess({
    role, userId, hasScopeWithoutCostType,
    verdicts: scopes.map((s) => resolved.get(scopeKey(s)) ?? { assignedUserId: null, effectiveUserId: null }),
  });
}

/**
 * Проверка по существующему заказу — путь ВСЕХ прочих мутаций.
 *
 * Области берутся из СНИМКОВ самого заказа (supplier_order_items.contractor_id/cost_type_id/
 * agg_key + supplier_orders.project_id), а не через material_request_items. Связь с позициями
 * заявок рвётся при доработке заявки (request_item_id ON DELETE SET NULL), и построенная на ней
 * проверка у осиротевших позиций возвращала ПУСТОЙ список областей — то есть «доступ разрешён»
 * кому угодно. Снимки не рвутся никогда.
 */
export async function assertOrderAccessForOrder(
  db: Db,
  user: { id: string; role: Role },
  orderId: string,
): Promise<CategoryAccess> {
  if (OVERRIDE_ROLES.has(user.role)) return { ok: true };

  const { rows } = await db.query(
    `SELECT so.created_by, soi.contractor_id, soi.cost_type_id, soi.agg_key, so.project_id
       FROM supplier_orders so
       LEFT JOIN supplier_order_items soi ON soi.order_id = so.id
      WHERE so.id = $1`,
    [orderId],
  );
  if (rows.length === 0) return { ok: false, reason: 'Заказ не найден' };

  const createdBy = rows[0].created_by as string | null;
  // LEFT JOIN даёт одну строку с NULL-полями, если позиций нет — это и есть пустой заказ.
  const scopes = rows
    .filter((r) => r.agg_key != null)
    .map((r) => ({
      projectId: r.project_id as string | null,
      contractorId: r.contractor_id as string | null,
      costTypeId: r.cost_type_id as string | null,
      aggKey: r.agg_key as string,
    }));

  if (scopes.length === 0) {
    return decideOrderAccess({
      role: user.role, userId: user.id, createdBy,
      verdicts: [], hasScopeWithoutCostType: false, isEmptyOrder: true,
    });
  }
  return assertOrderAccess(db, user.id, user.role, scopes);
}
