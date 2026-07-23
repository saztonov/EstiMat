/**
 * Сборка итогового результата.
 *
 * Полнота обеспечивается КОНСТРУКЦИЕЙ, а не доверием к модели: мы стартуем с полного множества
 * строк и раскладываем его, а не проверяем ответ на полноту. Всё, что модель не упомянула или
 * упомянула противоречиво, оседает в ungrouped. Поэтому
 *   covered + shared + ungrouped = total
 * выполняется всегда, и сводка умного режима сходится со сводом.
 */
import type { GroupingResult, MaterialGroupDto } from '@estimat/shared';
import type { DraftBatch, DraftGroup, GroupingLine } from './types.js';

export interface MergeOp {
  into: string;
  from: string[];
  name: string | null;
  /** Пересмотренная оценка объединённой группы от модели; null — вернуться к «худшему из двух». */
  purpose: string | null;
  stage: DraftGroup['stage'];
  completeness: DraftGroup['completeness'] | null;
  compatibility: DraftGroup['compatibility'] | null;
}

/**
 * Слить черновые группы по указаниям фазы reduce. Merge глобальный — вида работ как границы больше
 * нет, один комплект под разными видами работ слить можно. Оценку объединённой группы берём из
 * пересмотра модели; если его нет — консервативно «худшее из двух».
 *
 * Стадия готовности — отрицательная граница: две РАЗНЫЕ известные стадии не сливаются, чего бы ни
 * попросила модель (скрытые работы до отделки и финишный монтаж после неё закупаются к разным
 * порогам готовности). Совпадение стадии, наоборот, ничего не разрешает само по себе — слияние
 * по-прежнему требует решения модели.
 */
export function applyMerges(groups: DraftGroup[], merges: MergeOp[]): { groups: DraftGroup[]; warnings: string[] } {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const removed = new Set<string>();
  const warnings: string[] = [];
  let stageBlocked = 0;

  for (const op of merges) {
    const target = byId.get(op.into);
    if (!target || removed.has(op.into)) continue;
    let mergedAny = false;
    for (const fromId of op.from) {
      const src = byId.get(fromId);
      if (!src || removed.has(fromId) || fromId === op.into) continue;
      // null и 'other' границей не считаем: «не знаю» не должно мешать верному слиянию.
      if (isStageConflict(target.stage, src.stage)) {
        stageBlocked++;
        continue;
      }
      for (const k of src.orderKeys) if (!target.orderKeys.includes(k)) target.orderKeys.push(k);
      target.issues.push(...src.issues);
      target.missing.push(...src.missing);
      // Фолбэк-оценка на случай, если модель не прислала пересмотр: худшее из двух.
      target.completeness = worstCompleteness(target.completeness, src.completeness);
      target.compatibility = worstCompatibility(target.compatibility, src.compatibility);
      removed.add(fromId);
      mergedAny = true;
    }
    if (!mergedAny) continue;
    if (op.name) target.name = op.name;
    if (op.purpose) target.purpose = op.purpose;
    // Пересмотр модели перекрывает фолбэк: две неполные половины вместе могут быть комплектом.
    if (op.stage) target.stage = op.stage;
    if (op.completeness) target.completeness = op.completeness;
    if (op.compatibility) target.compatibility = op.compatibility;
    sanitize(target);
  }

  if (stageBlocked > 0) {
    warnings.push(`${stageBlocked} объединений отклонено: группы относятся к разным стадиям готовности`);
  }
  return { groups: groups.filter((g) => !removed.has(g.id)), warnings };
}

/** Разные стадии готовности, обе названные моделью. 'other' — это «не определил», а не стадия. */
const isStageConflict = (a: DraftGroup['stage'], b: DraftGroup['stage']): boolean =>
  !!a && !!b && a !== 'other' && b !== 'other' && a !== b;

/**
 * Привести замечания объединённой группы в согласие с её оценкой.
 *
 * Слияние складывает issues и missing половин, и без чистки укрупнённый комплект носит требования,
 * которые вторая половина уже закрыла: «не хватает смесителя» у группы, куда смеситель как раз и
 * влился. Условные и рекомендательные пункты остаются — это подсказки сметчику, а не диагноз.
 */
function sanitize(g: DraftGroup): void {
  const seenIssue = new Set<string>();
  g.issues = g.issues.filter((i) => {
    const key = `${i.severity}|${i.message}`;
    if (seenIssue.has(key)) return false;
    seenIssue.add(key);
    return true;
  });

  const seenMissing = new Set<string>();
  g.missing = g.missing.filter((m) => {
    if (g.completeness === 'complete' && m.need === 'required') return false;
    const key = `${m.name}|${m.need}`;
    if (seenMissing.has(key)) return false;
    seenMissing.add(key);
    return true;
  });
}

const worstCompleteness = (a: DraftGroup['completeness'], b: DraftGroup['completeness']): DraftGroup['completeness'] =>
  a === 'incomplete' || b === 'incomplete' ? 'incomplete' : a === 'unknown' || b === 'unknown' ? 'unknown' : 'complete';

const worstCompatibility = (a: DraftGroup['compatibility'], b: DraftGroup['compatibility']): DraftGroup['compatibility'] =>
  a === 'possible_issue' || b === 'possible_issue'
    ? 'possible_issue'
    : a === 'unknown' || b === 'unknown'
      ? 'unknown'
      : 'no_issues';

/** Собрать итог: разложить ВСЕ строки входа по группам / общим / не сгруппированным. */
export function assembleResult(
  lines: GroupingLine[],
  drafts: DraftBatch[],
  merges: MergeOp[],
  batchesPlanned: number,
): { result: GroupingResult; warnings: string[] } {
  const known = new Set(lines.map((l) => l.orderKey));
  const warnings = drafts.flatMap((d) => d.warnings);

  const allDraft = drafts.flatMap((d) => d.groups);
  const merged = applyMerges(allDraft, merges);
  warnings.push(...merged.warnings);

  // Строка максимум в одной группе: страхуемся ещё раз — после слияния группы могли пересечься.
  const taken = new Set<string>();
  const groups: MaterialGroupDto[] = [];
  const conflicted = new Set<string>();
  for (const g of merged.groups) {
    const keys = g.orderKeys.filter((k) => known.has(k));
    const fresh: string[] = [];
    for (const k of keys) {
      if (taken.has(k)) conflicted.add(k);
      else fresh.push(k);
    }
    if (fresh.length === 0) continue;
    for (const k of fresh) taken.add(k);
    groups.push({
      id: g.id,
      name: g.name,
      purpose: g.purpose,
      completeness: g.completeness,
      compatibility: g.compatibility,
      orderKeys: fresh,
      issues: g.issues.map((i) => ({ ...i, orderKeys: i.orderKeys.filter((k) => known.has(k)) })),
      missing: g.missing,
    });
  }

  const shared = [...new Set(drafts.flatMap((d) => d.sharedKeys))].filter((k) => known.has(k) && !taken.has(k));
  for (const k of shared) taken.add(k);

  // Остаток = не распределено моделью + отброшенное при валидации + конфликты.
  const ungrouped = lines.map((l) => l.orderKey).filter((k) => !taken.has(k));
  if (conflicted.size) {
    warnings.push(`${conflicted.size} поз. попали в несколько комплектов — перенесены в «Не удалось сгруппировать»`);
  }

  const covered = groups.reduce((s, g) => s + g.orderKeys.length, 0);
  return {
    result: {
      groups,
      sharedKeys: shared,
      ungroupedKeys: ungrouped,
      stats: {
        batches: batchesPlanned,
        groups: groups.length,
        covered,
        shared: shared.length,
        ungrouped: ungrouped.length,
        total: lines.length,
      },
    },
    warnings,
  };
}
