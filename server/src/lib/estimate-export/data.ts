// Сбор и группировка данных сметы для экспорта в шаблон «КП».
//
// Клиент присылает набор ВИДИМЫХ (отфильтрованных на странице) работ в виде
// [{ id, locationLabel }] — фильтры на «Сметы» применяются в памяти клиента, поэтому
// именно клиент решает, что попадёт в выгрузку. Сервер валидирует принадлежность id
// смете, подтягивает материалы, группирует строки по локации (в каноническом порядке
// как в GET /:id) и нумерует.

import type { Pool } from 'pg';
import { bucketBy, ITEMS_CANONICAL_ORDER_BY } from '../estimate-detail.js';
import type { ExportConflict } from './references.js';

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

/**
 * Собрать блоки строк для экспорта. Порядок работ — канонический (как в GET /:id:
 * зона → этаж → категория/вид → sort_order), группировка — по метке локации от клиента.
 * Бросает ExportError, если какой-то id не принадлежит смете.
 */
export async function gatherExportData(
  pool: Pool,
  estimateId: string,
  refs: ExportItemRef[],
): Promise<ExportBlock[]> {
  const ids = refs.map((r) => r.id);
  const labelById = new Map(refs.map((r) => [r.id, r.locationLabel]));

  const works = await pool.query(
    `SELECT ei.id, ei.description, ei.quantity, ei.unit,
            lt.name AS location_type_name
       FROM estimate_items ei
       LEFT JOIN cost_types ct   ON ei.cost_type_id = ct.id
       LEFT JOIN cost_categories cc ON ei.cost_category_id = cc.id
       LEFT JOIN project_zones z ON ei.zone_id = z.id
       LEFT JOIN room_types rt   ON ei.room_type_id = rt.id
       LEFT JOIN project_location_types lt ON ei.location_type_id = lt.id
      WHERE ei.estimate_id = $1 AND ei.id = ANY($2::uuid[])
      ORDER BY ${ITEMS_CANONICAL_ORDER_BY}`,
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

  const mats = await pool.query(
    `SELECT em.item_id, em.description, em.quantity, em.unit, em.qty_ratio,
            mc.name AS material_name
       FROM estimate_materials em
       LEFT JOIN material_catalog mc ON em.material_id = mc.id
      WHERE em.item_id = ANY($1::uuid[])
      ORDER BY em.sort_order, em.created_at`,
    [ids],
  );
  const matsByItem = bucketBy(mats.rows, (m) => m.item_id as string);

  // Примечания (комментарии) работ → в столбец «Примечание»; несколько склеиваем через \n
  // (хронологически: ORDER BY created_at).
  const notesRes = await pool.query(
    `SELECT item_id, body FROM estimate_comments
      WHERE item_id = ANY($1::uuid[]) ORDER BY item_id, created_at`,
    [ids],
  );
  const notesByItem = bucketBy(notesRes.rows, (n) => n.item_id as string);

  // Группировка по метке локации; порядок блоков — по первому появлению в каноне.
  const blockByLabel = new Map<string, ExportBlock>();
  const blocks: ExportBlock[] = [];
  let workNo = 0;

  for (const w of works.rows) {
    const label = labelById.get(w.id as string) ?? '';
    let block = blockByLabel.get(label);
    if (!block) {
      block = { locationLabel: label, rows: [] };
      blockByLabel.set(label, block);
      blocks.push(block);
    }
    workNo += 1;
    block.rows.push({
      kind: 'work',
      number: String(workNo),
      typeName: (w.location_type_name as string | null) ?? null,
      name: (w.description as string | null) ?? '',
      unit: (w.unit as string | null) ?? null,
      volume: num(w.quantity),
      coef: null,
      notes: (notesByItem.get(w.id as string) ?? []).map((n) => n.body as string).join('\n') || null,
    });
    const itemMats = matsByItem.get(w.id as string) ?? [];
    itemMats.forEach((m, i) => {
      block!.rows.push({
        kind: 'material',
        number: `${workNo}.${i + 1}`,
        typeName: null,
        name: (m.description as string | null) ?? (m.material_name as string | null) ?? '',
        unit: (m.unit as string | null) ?? null,
        volume: num(m.quantity),
        coef: num(m.qty_ratio),
      });
    });
  }

  return blocks;
}
