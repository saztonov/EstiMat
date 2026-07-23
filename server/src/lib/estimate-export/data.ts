// Сбор и группировка данных сметы для экспорта в шаблон «КП».
//
// Клиент присылает набор ВИДИМЫХ (отфильтрованных на странице) работ в виде
// [{ id, locationLabel }] — фильтры на «Сметы» применяются в памяти клиента, поэтому
// именно клиент решает, что попадёт в выгрузку. Сервер валидирует принадлежность id
// смете, подтягивает материалы, группирует строки по локации (в каноническом порядке
// как в GET /:id) и нумерует.

import type { Pool, PoolClient } from 'pg';
import { bucketBy, ITEMS_CANONICAL_ORDER_BY } from '../estimate-detail.js';
import type { ExportConflict } from './references.js';
import {
  contentHash,
  normalizeLocations,
  type VorItemSnapshot,
} from './vor-content.js';

export class ExportError extends Error {
  status: number;
  code?: string;
  data?: unknown;
  constructor(message: string, status = 400, opts?: { code?: string; data?: unknown }) {
    super(message);
    this.name = 'ExportError';
    this.status = status;
    this.code = opts?.code;
    this.data = opts?.data;
  }
}

/** Конфликт единиц измерения у одинаковых наименований (МАТЕРИАЛЫ/РАБОТЫ). Клиент показывает модалку. */
export class ExportUnitConflictError extends ExportError {
  conflicts: ExportConflict[];
  constructor(conflicts: ExportConflict[]) {
    super('Разные единицы измерения у одинаковых наименований', 409, {
      code: 'EXPORT_UNIT_CONFLICTS',
      data: { conflicts },
    });
    this.name = 'ExportUnitConflictError';
    this.conflicts = conflicts;
  }
}

/** Ссылка на видимую работу от клиента: id + человекочитаемая метка локации. */
export interface ExportItemRef {
  id: string;
  locationLabel: string;
}

export interface ExportRow {
  kind: 'work' | 'material';
  number: string; //      A: «1», «1.1»
  typeName: string | null; // C: тип отделки (только для работы)
  name: string; //        D: наименование
  unit: string | null; // F: ед. изм.
  volume: number | null; // G: объём (quantity)
  coef: number | null; //  H: коэффициент расхода (qty_ratio, только материал)
  notes?: string | null; // O: примечания (комментарии) работы, несколько склеены через \n
  /** O (следом за notes): состав работы из справочника. Отдельное поле, а не часть notes —
   *  канонизатор v1 не должен видеть состав в примечаниях, иначе старые ВОР «покраснеют». */
  composition?: string | null;
  /** Строка сметы, породившая запись (у материала — его работа). В видимые листы не попадает:
   *  идёт в служебный лист-якорь, по которому цены из заполненного файла ложатся обратно.
   *  Сбор из БД проставляет его всегда; необязателен ради тестовых фикстур раскладки (selfcheck),
   *  где строки сметы нет и якорь не проверяется. */
  itemId?: string;
  /** Материал сметы (только kind='material'). */
  materialId?: string;
}

export interface ExportBlock {
  locationLabel: string;
  rows: ExportRow[];
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Согласованное чтение снимка сметы: короткая REPEATABLE READ READ ONLY транзакция, чтобы
// работы/материалы/примечания читались из одного согласованного состояния (иначе три отдельных
// запроса на pool могут «расстыковаться» при конкурентной правке во время сборки).
async function withReadSnapshot<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function toMaterialSnapshot(m: Record<string, unknown>) {
  return {
    materialId: m.id as string,
    name: ((m.description as string | null) ?? (m.material_name as string | null) ?? '') as string,
    unit: (m.unit as string | null) ?? null,
    volume: num(m.quantity),
    coef: num(m.qty_ratio),
  };
}

/** Результат сборки: блоки для XLSX + построчный снимок (manifest) + хэши содержимого. */
export interface VorGatherModel {
  blocks: ExportBlock[];
  items: VorItemSnapshot[];
  hashByItem: Map<string, Buffer>;
}

/**
 * Собрать данные экспорта в согласованном снимке: блоки строк (для XLSX, порядок канонический,
 * группировка по метке локации от клиента), построчный снимок значений (manifest) и SHA-256
 * содержимого каждой работы. Бросает ExportError, если какой-то id не принадлежит смете.
 */
export async function gatherExportModel(
  pool: Pool,
  estimateId: string,
  refs: ExportItemRef[],
): Promise<VorGatherModel> {
  const ids = refs.map((r) => r.id);
  const labelById = new Map(refs.map((r) => [r.id, r.locationLabel]));

  return withReadSnapshot(pool, async (client) => {
    const works = await client.query(
      `SELECT ei.id, ei.description, ei.quantity, ei.unit, ei.locations,
              lt.name AS location_type_name,
              r.description AS composition
         FROM estimate_items ei
         LEFT JOIN cost_types ct   ON ei.cost_type_id = ct.id
         LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
         LEFT JOIN project_zones z ON ei.zone_id = z.id
         LEFT JOIN room_types rt   ON ei.room_type_id = rt.id
         LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
         LEFT JOIN rates r         ON ei.rate_id = r.id
        WHERE ei.estimate_id = $1 AND ei.id = ANY($2::uuid[])
        ORDER BY ${ITEMS_CANONICAL_ORDER_BY}, ei.id`,
      [estimateId, ids],
    );

    // Валидация принадлежности: каждый запрошенный id должен найтись в этой смете.
    if (works.rows.length !== ids.length) {
      const found = new Set(works.rows.map((r) => r.id as string));
      const missing = ids.filter((id) => !found.has(id));
      throw new ExportError(
        `Часть строк не найдена в смете (${missing.length} из ${ids.length}). Обновите страницу и повторите.`,
        409,
      );
    }

    const mats = await client.query(
      `SELECT em.id, em.item_id, em.description, em.quantity, em.unit, em.qty_ratio,
              mc.name AS material_name
         FROM estimate_materials em
         LEFT JOIN material_catalog mc ON em.material_id = mc.id
        WHERE em.item_id = ANY($1::uuid[])
        ORDER BY em.sort_order, em.created_at, em.id`,
      [ids],
    );
    const matsByItem = bucketBy(mats.rows, (m) => m.item_id as string);

    // Примечания (комментарии) работ → столбец «Примечание»; склейка через \n (по created_at).
    const notesRes = await client.query(
      `SELECT item_id, body FROM estimate_comments
        WHERE item_id = ANY($1::uuid[]) ORDER BY item_id, created_at, id`,
      [ids],
    );
    const notesByItem = bucketBy(notesRes.rows, (n) => n.item_id as string);

    const blockByLabel = new Map<string, ExportBlock>();
    const blocks: ExportBlock[] = [];
    const items: VorItemSnapshot[] = [];
    const hashByItem = new Map<string, Buffer>();
    let workNo = 0;

    for (const w of works.rows) {
      const itemId = w.id as string;
      const label = labelById.get(itemId) ?? '';
      let block = blockByLabel.get(label);
      if (!block) {
        block = { locationLabel: label, rows: [] };
        blockByLabel.set(label, block);
        blocks.push(block);
      }
      workNo += 1;
      const notes = (notesByItem.get(itemId) ?? []).map((n) => n.body as string).join('\n') || null;
      // Состав работы берём из справочника по rate_id; у строк, набранных вручную (без ссылки
      // на справочник), его нет — в примечании останутся только комментарии.
      const composition = ((w.composition as string | null) ?? '').trim() || null;
      block.rows.push({
        kind: 'work',
        number: String(workNo),
        typeName: (w.location_type_name as string | null) ?? null,
        name: (w.description as string | null) ?? '',
        unit: (w.unit as string | null) ?? null,
        volume: num(w.quantity),
        coef: null,
        notes,
        composition,
        itemId,
      });
      const itemMats = matsByItem.get(itemId) ?? [];
      itemMats.forEach((m, i) => {
        block!.rows.push({
          kind: 'material',
          number: `${workNo}.${i + 1}`,
          typeName: null,
          name: (m.description as string | null) ?? (m.material_name as string | null) ?? '',
          unit: (m.unit as string | null) ?? null,
          volume: num(m.quantity),
          coef: num(m.qty_ratio),
          itemId,
          materialId: m.id as string,
        });
      });

      const snap: VorItemSnapshot = {
        itemId,
        name: (w.description as string | null) ?? '',
        unit: (w.unit as string | null) ?? null,
        volume: num(w.quantity),
        typeName: (w.location_type_name as string | null) ?? null,
        locations: normalizeLocations(w.locations),
        locationLabel: label,
        notes,
        composition,
        materials: itemMats.map(toMaterialSnapshot),
      };
      items.push(snap);
      hashByItem.set(itemId, contentHash(snap));
    }

    return { blocks, items, hashByItem };
  });
}

/** Обёртка обратной совместимости: только блоки для XLSX (контракт exportEstimateKp). */
export async function gatherExportData(
  pool: Pool,
  estimateId: string,
  refs: ExportItemRef[],
): Promise<ExportBlock[]> {
  return (await gatherExportModel(pool, estimateId, refs)).blocks;
}

/**
 * Облегчённый сбор ТЕКУЩЕГО снимка существующих работ (для сравнения с baseline ВОР): без
 * нумерации/группировки и без ExportError на отсутствующие id (удалённые работы просто не
 * попадают в результат → трактуются вызывающим как deleted). locationLabel не заполняется
 * (в хэш не входит; для diff метку рендерит вызывающий из структуры locations).
 */
export async function gatherVorItemSnapshots(
  pool: Pool,
  estimateId: string,
  itemIds: string[],
): Promise<Map<string, VorItemSnapshot>> {
  if (itemIds.length === 0) return new Map();
  return withReadSnapshot(pool, async (client) => {
    const works = await client.query(
      // Состав работы (r.description) обязателен и здесь: по этому снимку считается ТЕКУЩИЙ хэш
      // строки. Без него у ВОР схемы v2 текущий хэш никогда не совпал бы с сохранённым, и все
      // такие ВОР висели бы «изменено».
      `SELECT ei.id, ei.description, ei.quantity, ei.unit, ei.locations,
              lt.name AS location_type_name,
              r.description AS composition
         FROM estimate_items ei
         LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
         LEFT JOIN rates r ON ei.rate_id = r.id
        WHERE ei.estimate_id = $1 AND ei.id = ANY($2::uuid[])`,
      [estimateId, itemIds],
    );
    const mats = await client.query(
      `SELECT em.id, em.item_id, em.description, em.quantity, em.unit, em.qty_ratio,
              mc.name AS material_name
         FROM estimate_materials em
         LEFT JOIN material_catalog mc ON em.material_id = mc.id
        WHERE em.item_id = ANY($1::uuid[])
        ORDER BY em.sort_order, em.created_at, em.id`,
      [itemIds],
    );
    const matsByItem = bucketBy(mats.rows, (m) => m.item_id as string);
    const notesRes = await client.query(
      `SELECT item_id, body FROM estimate_comments
        WHERE item_id = ANY($1::uuid[]) ORDER BY item_id, created_at, id`,
      [itemIds],
    );
    const notesByItem = bucketBy(notesRes.rows, (n) => n.item_id as string);

    const map = new Map<string, VorItemSnapshot>();
    for (const w of works.rows) {
      const itemId = w.id as string;
      const itemMats = matsByItem.get(itemId) ?? [];
      map.set(itemId, {
        itemId,
        name: (w.description as string | null) ?? '',
        unit: (w.unit as string | null) ?? null,
        volume: num(w.quantity),
        typeName: (w.location_type_name as string | null) ?? null,
        locations: normalizeLocations(w.locations),
        locationLabel: '',
        notes: (notesByItem.get(itemId) ?? []).map((n) => n.body as string).join('\n') || null,
        composition: ((w.composition as string | null) ?? '').trim() || null,
        materials: itemMats.map(toMaterialSnapshot),
      });
    }
    return map;
  });
}
