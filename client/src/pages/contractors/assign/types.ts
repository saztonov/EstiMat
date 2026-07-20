import type { BulkAssignAllocation } from '@estimat/shared';
import type { EstimateItem } from '../../estimates/components/types';

// === Построчное назначение (поповер в ячейке «Исполнитель») ===
// Семантика прежняя: остаток строки, процент или абсолютный объём.
export type AssignMode = 'remainder' | 'percent' | 'qty';

export type AssignInput =
  | { mode: 'remainder'; contractorId: string }
  | { mode: 'percent'; contractorId: string; percent: number }
  | { mode: 'qty'; contractorId: string; qty: number };

// === Массовое назначение (поповер в шапке вида работ) ===
// Область действия в шапке: весь вид, только неназначенные строки или отмеченные галочками.
export type AssignScope = 'all' | 'new' | 'selected';

/** Параметры, общие для всех трёх областей: кто и на какую долю. */
export interface BulkAssignDraft {
  contractorId: string;
  allocation: BulkAssignAllocation;
}

/** Предпросмотр массового назначения — считается локально по видимым строкам. */
export interface AssignPreview {
  /** Строки, которые уйдут в запрос. */
  targets: EstimateItem[];
  /** Из них заняты другими подрядчиками (будут перезаписаны). */
  replaceCount: number;
  /** Защищены заявками — сервер их пропустит. */
  locked: EstimateItem[];
}

/** Подпись доли для текста подтверждения и панели отметки. */
export function allocationLabel(allocation: BulkAssignAllocation): string {
  return allocation.type === 'percent' ? `${allocation.percent}%` : 'весь объём';
}
