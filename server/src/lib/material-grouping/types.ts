import type { GroupingSettings } from '@estimat/shared';

/** Строка материала для группировки — канонический снимок из БД. */
export interface GroupingLine {
  /** Ключ заказа: lineKey(costTypeId, aggKey). Совпадает с ключом строки на клиенте. */
  orderKey: string;
  costTypeId: string | null;
  costTypeName: string | null;
  costCategoryId: string | null;
  costCategoryName: string | null;
  materialId: string | null;
  name: string;
  unit: string;
  quantity: number;
  /** Группа справочника (material_groups) — единственный контекст помимо названия. */
  materialGroupName: string | null;
  /** Работы-источники (уникальные имена). */
  workNames: string[];
  /** Работа, за которой строка закреплена при батчинге (детерминированно). */
  primaryWorkId: string;
  /** Сигнатура набора локаций строки (id-based, без типа). */
  locationSig: string;
  /** Сигнатура набора типов работ строки. */
  typeSig: string;
  locationLabels: string[];
  typeLabels: string[];
}

/** Набор строк для одного вызова модели. */
export interface GroupingBatch {
  index: number;
  /** Ключ hard partition: границы, которые модель не может пересечь физически. */
  partitionKey: string;
  lines: GroupingLine[];
}

/** Черновая группа из ответа модели (до сборки итога). */
export interface DraftGroup {
  id: string;
  batchIndex: number;
  partitionKey: string;
  name: string;
  purpose: string | null;
  completeness: 'complete' | 'incomplete' | 'unknown';
  compatibility: 'no_issues' | 'possible_issue' | 'unknown';
  orderKeys: string[];
  issues: { severity: 'warning' | 'review' | 'recommendation'; message: string; orderKeys: string[] }[];
  missing: { name: string; reason: string; need: 'required' | 'conditional' | 'recommended' }[];
}

/** Результат разбора одного батча. */
export interface DraftBatch {
  batchIndex: number;
  partitionKey: string;
  groups: DraftGroup[];
  sharedKeys: string[];
  ungroupedKeys: string[];
  warnings: string[];
}

export type { GroupingSettings };
