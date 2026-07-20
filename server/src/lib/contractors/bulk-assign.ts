/**
 * Планировщик массового назначения подрядчика на строки сметы (раздел «Подрядчики»).
 *
 * Раскладывает переданные строки на четыре корзины: назначаемые, требующие снятия чужих
 * назначений, пропущенные по стратегии и защищённые заявками. Один планировщик обслуживает
 * и запись (bulk-роут), и построчное снятие (DELETE), поэтому «что покажем» и «что сделаем»
 * не могут разойтись.
 *
 * Что значит «защищена». По строке уже заказаны материалы у этого подрядчика, поэтому снять
 * или заменить его нельзя — заявка осталась бы без сметного основания. Изменение доли того же
 * подрядчика защитой не запрещено: заявка при этом не осиротеет.
 *
 * Защита действует на СТРОКУ целиком, а не на отдельное назначение: если на строке защищён хотя
 * бы один из подрядчиков, строку не трогаем вовсе. Иначе после снятия незащищённых на строке
 * остался бы защищённый плюс новый, и validate_item_contractor() (0020) отклонил бы «весь объём».
 */
import type { AssignBlockedItem, BulkAssignAllocation } from '@estimat/shared';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export type BulkAssignStrategy = 'replace' | 'unassigned_only';

/** Строка скоупа с её чужими назначениями и признаками защиты — сырьё для раскладки. */
export interface ScopeRow {
  itemId: string;
  /** Назначения ДРУГИХ подрядчиков (целевой сюда не попадает — он просто перезапишется). */
  foreign: { contractorId: string; contractorName: string | null }[];
  /** Есть точная (или восстановленная) связь позиции заявки с этой строкой. */
  lockedLinked: { contractorId: string; contractorName: string | null }[];
  /** Заявка без связи — блокируем консервативно по виду работ. */
  lockedLegacy: { contractorId: string; contractorName: string | null }[];
}

export interface BulkAssignPlan {
  /** Строки под UPSERT целевого подрядчика. */
  assignItemIds: string[];
  /** Строки, с которых надо снять чужие назначения. */
  removeItemIds: string[];
  replacedRows: number;
  replacedAssignments: number;
  skipped: number;
  blocked: AssignBlockedItem[];
}

/**
 * Чистая раскладка — без обращений к БД, поэтому проверяема тестами.
 * Правила:
 *   replace          — берём всё, кроме защищённых строк; занятые чужими попадают ещё и в remove;
 *   unassigned_only  — берём только строки вообще без назначений (защищённая строка занята
 *                      по определению, поэтому под эту стратегию не попадает).
 */
export function planBulkAssign(rows: ScopeRow[], strategy: BulkAssignStrategy): BulkAssignPlan {
  const assignItemIds: string[] = [];
  const removeItemIds: string[] = [];
  const blocked: AssignBlockedItem[] = [];
  let replacedAssignments = 0;
  let skipped = 0;

  for (const row of rows) {
    // Точная связь важнее запасной: если строка защищена и той и другой, показываем
    // пользователю более достоверную причину.
    const locked = row.lockedLinked.length > 0 ? row.lockedLinked : row.lockedLegacy;
    if (locked.length > 0) {
      blocked.push({
        itemId: row.itemId,
        contractors: locked.map((c) => ({ contractorId: c.contractorId, contractorName: c.contractorName })),
        reason: row.lockedLinked.length > 0 ? 'material_requests' : 'material_requests_legacy',
      });
      continue;
    }

    if (strategy === 'unassigned_only') {
      if (row.foreign.length > 0) {
        skipped += 1;
        continue;
      }
      assignItemIds.push(row.itemId);
      continue;
    }

    assignItemIds.push(row.itemId);
    if (row.foreign.length > 0) {
      removeItemIds.push(row.itemId);
      replacedAssignments += row.foreign.length;
    }
  }

  return {
    assignItemIds,
    removeItemIds,
    replacedRows: removeItemIds.length,
    replacedAssignments,
    skipped,
    blocked,
  };
}

/**
 * Собрать скоуп из БД: строки сметы, чужие назначения на них и защиту заявками.
 *
 * Вызывается ВНУТРИ транзакции после FOR UPDATE на строках (для записи) либо по пулу
 * (для чтения — например, чтобы разметить строки замком в детализации сметы).
 *
 * targetContractorId = null → «чужими» считаются все подрядчики строки (путь снятия).
 */
export async function loadScopeRows(
  db: Db,
  params: { estimateId: string; itemIds: string[]; targetContractorId: string | null },
): Promise<ScopeRow[]> {
  const { estimateId, itemIds, targetContractorId } = params;
  if (itemIds.length === 0) return [];

  const { rows } = await db.query(
    `WITH scope AS (
       SELECT ei.id AS item_id, ei.cost_type_id
         FROM estimate_items ei
        WHERE ei.id = ANY($1::uuid[]) AND ei.estimate_id = $2::uuid
     ),
     -- Активные заявки сметы. Отменённые защиту НЕ держат: иначе снять назначение стало бы
     -- возможно только после физического удаления заявки администратором.
     live AS (
       SELECT mr.id, mr.contractor_id
         FROM material_requests mr
        WHERE mr.estimate_id = $2::uuid AND mr.status <> 'cancelled'
     ),
     -- Точная/восстановленная связь позиции заявки со строкой сметы.
     linked_hold AS (
       SELECT DISTINCT src.item_id, l.contractor_id
         FROM material_request_item_sources src
         JOIN material_request_items mri ON mri.id = src.request_item_id
         JOIN live l ON l.id = mri.request_id
        WHERE src.item_id = ANY($1::uuid[])
          AND mri.link_resolution IN ('exact', 'reconstructed')
     ),
     -- Запасной путь для позиций без связи: блокируем весь вид работ подрядчика.
     -- Лишняя блокировка допустима, пропущенная (осиротить заявку) — нет.
     legacy_hold AS (
       SELECT DISTINCT l.contractor_id, mri.cost_type_id
         FROM material_request_items mri
         JOIN live l ON l.id = mri.request_id
        WHERE mri.link_resolution = 'unresolved'
     )
     SELECT s.item_id,
            eic.contractor_id,
            o.name AS contractor_name,
            (lh.item_id IS NOT NULL) AS hold_linked,
            EXISTS (SELECT 1 FROM legacy_hold g
                     WHERE g.contractor_id = eic.contractor_id
                       AND g.cost_type_id IS NOT DISTINCT FROM s.cost_type_id) AS hold_legacy
       FROM scope s
       LEFT JOIN estimate_item_contractors eic
              ON eic.item_id = s.item_id
             AND ($3::uuid IS NULL OR eic.contractor_id <> $3::uuid)
       LEFT JOIN linked_hold lh ON lh.item_id = s.item_id AND lh.contractor_id = eic.contractor_id
       LEFT JOIN organizations o ON o.id = eic.contractor_id`,
    [itemIds, estimateId, targetContractorId],
  );

  // LEFT JOIN оставляет строку без назначений с contractor_id = NULL — это валидный случай
  // (строка свободна), поэтому группируем по item_id и пропускаем пустые назначения.
  const byItem = new Map<string, ScopeRow>();
  for (const r of rows) {
    const itemId = r.item_id as string;
    let row = byItem.get(itemId);
    if (!row) {
      row = { itemId, foreign: [], lockedLinked: [], lockedLegacy: [] };
      byItem.set(itemId, row);
    }
    const contractorId = r.contractor_id as string | null;
    if (!contractorId) continue;
    const entry = { contractorId, contractorName: (r.contractor_name as string | null) ?? null };
    row.foreign.push(entry);
    if (r.hold_linked) row.lockedLinked.push(entry);
    else if (r.hold_legacy) row.lockedLegacy.push(entry);
  }
  return [...byItem.values()];
}

/** Значения assigned_qty / assigned_percent для выбранной доли. */
export function allocationValues(allocation: BulkAssignAllocation): {
  qty: number | null;
  percent: number | null;
} {
  return allocation.type === 'percent'
    ? { qty: null, percent: allocation.percent }
    : { qty: null, percent: null }; // «весь объём» — оба NULL (см. validate_item_contractor)
}
