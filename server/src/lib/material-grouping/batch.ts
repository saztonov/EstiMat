/**
 * Планирование батчей — ТОЛЬКО техническая нарезка.
 *
 * Зачем: смета не помещается в один ответ модели (лимит вывода ~8192 токена), режем на наборы по
 * ~80 строк. Родственное держим вместе по affinity (вид работ → работа), чтобы модель видела
 * операцию целиком, но это НЕ граница: группы разных наборов вправе слиться глобальным merge.
 *
 * План ДЕТЕРМИНИРОВАН: один и тот же вход всегда даёт одни и те же батчи. На этом держится resume —
 * после перезапуска раннер обязан получить тот же план, иначе checkpoint не сойдётся. ALGO_VERSION
 * повышается при изменении нарезки, чтобы задания старого алгоритма не доигрывались по чужому плану.
 */
import type { GroupingBatch, GroupingLine } from './types.js';

/** Версия алгоритма нарезки. Входит в хэш и снимок задания; resume несовместимой версии запрещён. */
export const ALGO_VERSION = 'batch-2';

export const MAX_LINES_PER_BATCH = 80;
/** Ограничение на объём названий в батче: 80 длинных позиций тоже должны влезть в ответ. */
export const MAX_NAME_CHARS_PER_BATCH = 7000;

/** Affinity набора — вид работ его строк. Пишется в журнал как partition_key (для отладки). */
const affinityKeyOf = (costTypeId: string | null): string => `ct:${costTypeId ?? ''}`;

const nameCost = (l: GroupingLine) => l.name.length + 24;

/** Разрезать одну слишком большую работу. Порядок стабильный: группа справочника → название. */
function splitOversizedWork(lines: GroupingLine[]): GroupingLine[][] {
  const sorted = [...lines].sort(
    (a, b) =>
      (a.materialGroupName ?? '').localeCompare(b.materialGroupName ?? '', 'ru') ||
      a.name.localeCompare(b.name, 'ru') ||
      a.orderKey.localeCompare(b.orderKey),
  );
  const chunks: GroupingLine[][] = [];
  let cur: GroupingLine[] = [];
  let chars = 0;
  for (const l of sorted) {
    if (cur.length >= MAX_LINES_PER_BATCH || (cur.length && chars + nameCost(l) > MAX_NAME_CHARS_PER_BATCH)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(l);
    chars += nameCost(l);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Упаковать работы в наборы (first-fit-decreasing). Работа целиком в одном наборе. */
function packWorks(works: GroupingLine[][]): GroupingLine[][] {
  const bins: { lines: GroupingLine[]; chars: number }[] = [];
  // Крупные работы первыми — иначе они не влезут в уже занятые наборы. Тай-брейк — по
  // МИНИМАЛЬНОМУ ключу работы: порядок строк внутри работы зависит от выборки, и план перестал
  // бы быть детерминированным (а на нём держится resume).
  const minKey = (w: GroupingLine[]) => w.reduce((m, l) => (l.orderKey < m ? l.orderKey : m), w[0]?.orderKey ?? '');
  const sorted = [...works].sort((a, b) => b.length - a.length || minKey(a).localeCompare(minKey(b)));
  for (const work of sorted) {
    const chars = work.reduce((s, l) => s + nameCost(l), 0);
    const bin = bins.find(
      (b) => b.lines.length + work.length <= MAX_LINES_PER_BATCH && b.chars + chars <= MAX_NAME_CHARS_PER_BATCH,
    );
    if (bin) {
      bin.lines.push(...work);
      bin.chars += chars;
    } else {
      bins.push({ lines: [...work], chars });
    }
  }
  return bins.map((b) => b.lines);
}

/** Составить план батчей. Чистая функция: одинаковый вход → одинаковый выход. */
export function planBatches(lines: GroupingLine[]): GroupingBatch[] {
  // Affinity верхнего уровня — вид работ: родственное держим вместе, но это не запрет на слияние.
  const byCostType = new Map<string, GroupingLine[]>();
  for (const l of lines) {
    const key = l.costTypeId ?? '';
    const bucket = byCostType.get(key);
    if (bucket) bucket.push(l);
    else byCostType.set(key, [l]);
  }

  const batches: GroupingBatch[] = [];
  for (const costTypeId of [...byCostType.keys()].sort()) {
    const partLines = byCostType.get(costTypeId)!;

    // Строки одной работы держим вместе: материалы одной операции не должны разъезжаться.
    const byWork = new Map<string, GroupingLine[]>();
    for (const l of partLines) {
      const bucket = byWork.get(l.primaryWorkId);
      if (bucket) bucket.push(l);
      else byWork.set(l.primaryWorkId, [l]);
    }

    const works: GroupingLine[][] = [];
    for (const workId of [...byWork.keys()].sort()) {
      const workLines = byWork.get(workId)!;
      const chars = workLines.reduce((s, l) => s + nameCost(l), 0);
      if (workLines.length > MAX_LINES_PER_BATCH || chars > MAX_NAME_CHARS_PER_BATCH) {
        works.push(...splitOversizedWork(workLines));
      } else {
        works.push(workLines);
      }
    }

    for (const binLines of packWorks(works)) {
      batches.push({
        index: batches.length,
        affinityKey: affinityKeyOf(costTypeId || null),
        lines: [...binLines].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.orderKey.localeCompare(b.orderKey)),
      });
    }
  }
  return batches;
}
