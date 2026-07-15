/**
 * Планирование батчей.
 *
 * Зачем вообще: 576 позиций в один ответ не помещаются — у LM Studio лимит вывода 8192 токена,
 * а ответ на всю смету это ~15 000. Режем на наборы по ~80 строк.
 *
 * Граница — работа, а не вид работ: в реальной смете «Отопление» это 410 строк из 576 (71 %),
 * и батч по виду работ ничего бы не решил. При этом только 6 строк из 576 встречаются больше
 * чем в одной работе, а средняя работа — 10 строк, так что работа режется идеально.
 *
 * План ДЕТЕРМИНИРОВАН: один и тот же вход всегда даёт одни и те же батчи. На этом держится
 * resume — после перезапуска раннер обязан получить тот же план, иначе checkpoint не сойдётся.
 */
import type { GroupingBatch, GroupingLine, GroupingSettings } from './types.js';

export const MAX_LINES_PER_BATCH = 80;
/** Ограничение на объём названий в батче: 80 длинных позиций тоже должны влезть в ответ. */
export const MAX_NAME_CHARS_PER_BATCH = 7000;

/**
 * Hard partition: границы, которые модель физически не может нарушить — материалов другого
 * partition просто нет в её запросе. Включённый флаг = материалы с разными значениями
 * объединять нельзя, поэтому валидация превращается в дешёвую проверку.
 */
export function partitionKeyOf(line: GroupingLine, s: GroupingSettings): string {
  const parts: string[] = [];
  if (s.costType) parts.push(`ct:${line.costTypeId ?? ''}`);
  if (s.location) parts.push(`loc:${line.locationSig}`);
  if (s.locationType) parts.push(`lt:${line.typeSig}`);
  return parts.join('|');
}

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
  // МИНИМАЛЬНОМУ ключу работы, а не по первой строке: порядок строк внутри работы зависит от
  // порядка выборки, и план перестал бы быть детерминированным (а на нём держится resume).
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
export function planBatches(lines: GroupingLine[], settings: GroupingSettings): GroupingBatch[] {
  const byPartition = new Map<string, GroupingLine[]>();
  for (const l of lines) {
    const key = partitionKeyOf(l, settings);
    const bucket = byPartition.get(key);
    if (bucket) bucket.push(l);
    else byPartition.set(key, [l]);
  }

  const batches: GroupingBatch[] = [];
  for (const partitionKey of [...byPartition.keys()].sort()) {
    const partLines = byPartition.get(partitionKey)!;

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
        partitionKey,
        lines: [...binLines].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.orderKey.localeCompare(b.orderKey)),
      });
    }
  }
  return batches;
}

/**
 * Партиции, размазанные больше чем по одному батчу: только их и нужно сливать вторым проходом.
 * Иначе «Монтаж трубопровода» из батча 1 и из батча 3 останутся двумя разными группами — даже
 * когда вид работ учитывается и обе группы законно лежат в одной партиции.
 */
export function partitionsNeedingMerge(batches: GroupingBatch[]): string[] {
  const count = new Map<string, number>();
  for (const b of batches) count.set(b.partitionKey, (count.get(b.partitionKey) ?? 0) + 1);
  return [...count.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort();
}
