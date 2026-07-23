import type { GroupingScope, GroupingSettings } from '@estimat/shared';

/** Строка материала для группировки — канонический снимок из БД, свёрнутый по ключу заказа. */
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
  /** Количество ДОЛИ подрядчика: сумма масштабированных вхождений (см. loadGroupingLines). */
  quantity: number;
  /** Группа справочника (material_groups) — контекст помимо названия. */
  materialGroupName: string | null;
  /** Работы-источники (уникальные имена, отсортированы для детерминизма хэша и промпта). */
  workNames: string[];
  /** Работа, за которой строка закреплена при батчинге (детерминированно, минимальный work_id). */
  primaryWorkId: string;
}

/** Набор строк для одного вызова модели. */
export interface GroupingBatch {
  index: number;
  /**
   * costType-происхождение набора (affinity): родственное держим в одном наборе. НЕ граница —
   * группы разных наборов могут слиться глобальным merge. Пишется в журнал как partition_key.
   */
  affinityKey: string;
  lines: GroupingLine[];
}

/**
 * Служебный ярлык стадии готовности. Модель выбирает его из закрытого списка; сервер использует
 * ярлык ТОЛЬКО как отрицательную границу слияния (разные известные стадии не сливаются). Совпадение
 * стадии основанием для слияния не является: одна стадия одной системы вмещает и магистраль, и
 * самостоятельно принимаемые узлы. В публичный MaterialGroupDto ярлык не выходит.
 */
export const GROUP_STAGES = ['prep', 'main', 'protection', 'finish', 'commissioning', 'other'] as const;
export type GroupStage = (typeof GROUP_STAGES)[number];

/** Черновая группа из ответа модели (до сборки итога). */
export interface DraftGroup {
  id: string;
  batchIndex: number;
  name: string;
  purpose: string | null;
  /** null — модель не назвала стадию или назвала вне списка. «Не знаю» слияние не блокирует. */
  stage: GroupStage | null;
  completeness: 'complete' | 'incomplete' | 'unknown';
  compatibility: 'no_issues' | 'possible_issue' | 'unknown';
  orderKeys: string[];
  issues: { severity: 'warning' | 'review' | 'recommendation'; message: string; orderKeys: string[] }[];
  missing: { name: string; reason: string; need: 'required' | 'conditional' | 'recommended' }[];
}

/** Результат разбора одного батча. */
export interface DraftBatch {
  batchIndex: number;
  groups: DraftGroup[];
  sharedKeys: string[];
  ungroupedKeys: string[];
  warnings: string[];
}

export type { GroupingScope, GroupingSettings };
