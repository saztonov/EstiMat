/**
 * Канонический вход для группировки — собирается ТОЛЬКО из БД.
 *
 * Клиент присылает смету и подрядчика; названия, количества и контексты сервер читает сам. Иначе
 * содержимое запроса к модели было бы управляемым из браузера, а вход мог бы разъехаться с тем,
 * что реально лежит в смете.
 *
 * Вход — материалы работ, НАЗНАЧЕННЫХ подрядчику, в полном количестве строки: работа достаётся
 * исполнителю целиком. Результат принадлежит паре (смета, подрядчик): неназначенное в расчёт не
 * входит и его пересчёт не заказывает. Проекции «общего результата под подрядчика» больше нет.
 */
import { createHash } from 'node:crypto';
import { aggKey, lineKey, type GroupingScope } from '@estimat/shared';
import type { Pool } from 'pg';
import type { GroupingLine } from './types.js';
import { ALGO_VERSION } from './batch.js';

/** Версия смысла области. Меняется, если состав scope расширяется (сейчас: смета + подрядчик). */
export const SCOPE_VERSION = 'c1';

interface RawRow {
  cost_type_id: string | null;
  cost_type_name: string | null;
  cost_category_id: string | null;
  cost_category_name: string | null;
  material_id: string | null;
  name: string;
  unit: string;
  quantity: string;
  material_group_name: string | null;
  work_id: string;
  work_name: string;
}

/**
 * Собрать строки материалов, назначенных подрядчику, свёрнутые по ключу заказа: количества
 * вхождений суммируются как есть — работа принадлежит исполнителю целиком.
 */
export async function loadGroupingLines(pool: Pool, scope: GroupingScope): Promise<GroupingLine[]> {
  const { rows } = await pool.query<RawRow>(
    `SELECT ei.cost_type_id,
            ct.name  AS cost_type_name,
            ei.cost_category_id,
            cc.name  AS cost_category_name,
            em.material_id,
            COALESCE(mc.name, em.description, 'Материал') AS name,
            em.unit,
            em.quantity::numeric AS quantity,
            mg.name  AS material_group_name,
            ei.id    AS work_id,
            ei.description AS work_name
       FROM estimate_items ei
       JOIN estimate_item_contractors eic ON eic.item_id = ei.id AND eic.contractor_id = $2
       JOIN estimate_materials em ON em.item_id = ei.id
       LEFT JOIN material_catalog mc ON mc.id = em.material_id
       LEFT JOIN material_groups mg  ON mg.id = mc.group_id
       LEFT JOIN cost_types ct       ON ct.id = ei.cost_type_id
       LEFT JOIN cost_categories cc  ON cc.id = ei.cost_category_id
      WHERE ei.estimate_id = $1`,
    [scope.estimateId, scope.contractorId],
  );

  // Свёртка по ключу заказа: строка атомарна, вхождения дают контекст и суммируют долю.
  const byKey = new Map<string, GroupingLine & { works: Set<string> }>();
  for (const r of rows) {
    const key = lineKey(r.cost_type_id, aggKey(r.material_id, r.name, r.unit));
    let line = byKey.get(key);
    if (!line) {
      line = {
        orderKey: key,
        costTypeId: r.cost_type_id,
        costTypeName: r.cost_type_name,
        costCategoryId: r.cost_category_id,
        costCategoryName: r.cost_category_name,
        materialId: r.material_id,
        name: r.name,
        unit: r.unit,
        quantity: 0,
        materialGroupName: r.material_group_name,
        workNames: [],
        primaryWorkId: r.work_id,
        works: new Set(),
      };
      byKey.set(key, line);
    }
    line.quantity += Number(r.quantity ?? 0);
    if (!line.works.has(r.work_id)) {
      line.works.add(r.work_id);
      line.workNames.push(r.work_name);
    }
    // Закрепление за работой — детерминированное: наименьший work_id из вхождений.
    if (r.work_id < line.primaryWorkId) line.primaryWorkId = r.work_id;
  }

  return [...byKey.values()]
    .map(({ works, ...line }) => {
      void works;
      // Порядок работ детерминирован: он влияет и на промпт (slice(0,3)), и на хэш.
      return { ...line, workNames: [...line.workNames].sort((a, b) => a.localeCompare(b, 'ru')) };
    })
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

/**
 * Хэш канонического входа. Меняется всё, что влияет на решение модели: состав строк, количества,
 * контекст (вид работ, группа справочника, работы), модель, версия промпта и версия алгоритма
 * батчинга. Не зависит от порядка строк — сортируем здесь.
 */
export function computeInputHash(lines: GroupingLine[], qualifiedModel: string, promptVersion: string): string {
  const sorted = [...lines].sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  const canonical = JSON.stringify({
    lines: sorted.map((l) => [
      l.orderKey,
      l.name,
      l.unit,
      // Округление до 4 знаков — та же точность, что в колонке «По смете»: плавающий хвост
      // не должен объявлять результат устаревшим.
      Math.round(l.quantity * 1e4) / 1e4,
      l.costTypeId ?? '',
      l.materialGroupName ?? '',
      // Сортируем и здесь: снимок мог прийти из старого задания с иным порядком работ.
      [...l.workNames].sort((a, b) => a.localeCompare(b, 'ru')),
    ]),
    qualifiedModel,
    promptVersion,
    algoVersion: ALGO_VERSION,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Эффективная версия промпта = базовая версия + полный SHA-256 от канонического JSON текстов и
 * режима рассуждений. Правка любого текста промпта (system/merge) или переключение noThink
 * инвалидируют кэш готовых результатов.
 */
export function computeEffectivePromptVersion(
  version: string,
  system: string,
  merge: string,
  noThink: boolean,
): string {
  const canonical = JSON.stringify({ version, system, merge, noThink });
  return `${version}:${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * Хэш области. Область — смета + подрядчик: результат принадлежит паре, уникальный индекс
 * uq_mgj_active_scope (estimate_id, scope_hash) даёт ровно одно активное задание на подрядчика.
 */
export function computeScopeHash(scope: GroupingScope): string {
  return createHash('sha256')
    .update(JSON.stringify({ ...scope, scopeVersion: SCOPE_VERSION }))
    .digest('hex');
}
