import { useCallback } from 'react';
import type { EstimateItem } from '../../estimates/components/types';
import type { AssignPreview } from './types';

const hasAssignments = (it: EstimateItem) => (it.item_contractors ?? []).length > 0;

/** Строка занята КЕМ-ТО, кроме выбранного подрядчика (его собственное назначение перезапишется). */
const hasForeign = (it: EstimateItem, contractorId: string) =>
  (it.item_contractors ?? []).some((c) => c.contractor_id !== contractorId);

/**
 * Строка защищена заявками от перезаписи: по ней уже заказаны материалы кем-то, кроме
 * выбранного подрядчика. Источник — request_locked_contractor_ids из детализации сметы;
 * авторитетом остаётся ответ сервера, здесь это только предпросмотр для диалога.
 */
const isLocked = (it: EstimateItem, contractorId: string) =>
  (it.request_locked_contractor_ids ?? []).some((id) => id !== contractorId);

/**
 * Предпросмотр массового назначения по ВИДИМЫМ строкам вида работ.
 * Считается локально и мгновенно — отдельный запрос к серверу ради чисел не нужен.
 */
export function useAssignPlan() {
  return useCallback(
    (works: EstimateItem[], contractorId: string, scope: 'all' | 'new'): AssignPreview => {
      const candidates = scope === 'new' ? works.filter((w) => !hasAssignments(w)) : works;
      const locked = candidates.filter((w) => isLocked(w, contractorId));
      const lockedIds = new Set(locked.map((w) => w.id));
      const targets = candidates.filter((w) => !lockedIds.has(w.id));
      return {
        targets,
        replaceCount: targets.filter((w) => hasForeign(w, contractorId)).length,
        locked,
      };
    },
    [],
  );
}

/** Число строк вида, на которые ещё никто не назначен, — счётчик в поповере. */
export const countUnassigned = (works: EstimateItem[]) => works.filter((w) => !hasAssignments(w)).length;
