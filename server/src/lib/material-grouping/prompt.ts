/**
 * Промпты умной группировки.
 *
 * Тексты по умолчанию (system и merge) вынесены в общий владелец lib/llm/prompts.ts и
 * редактируются в администрировании; здесь остаётся сборка пользовательских промптов с данными.
 *
 * Базовый текст резолвится один раз при создании задания (payload.snapshot) и входит в
 * input_hash, поэтому правка текста инвалидирует кэш, а resume/retry идут на том же тексте.
 *
 * PROMPT_VERSION — базовая версия формата; фактический отпечаток (полный хэш текстов) добавляется
 * при вычислении input_hash (см. computeEffectivePromptVersion).
 */
import type { GroupingBatch, GroupingLine, DraftGroup } from './types.js';

export const PROMPT_VERSION = 'mg-3';

/** Системный промпт = базовый текст из снимка задания. Границ больше нет — вид работ это affinity. */
export function buildSystemPrompt(baseText: string): string {
  return baseText;
}

/** Строка для модели: idx + название + ед + количество + контекст происхождения. */
function lineText(l: GroupingLine, idx: number): string {
  const parts = [`${idx}|${l.name}|${l.unit}|${round(l.quantity)}`];
  // Вид работ — контекст происхождения (affinity), а не граница: помогает узнать операцию.
  if (l.costTypeName) parts.push(`вид работ: ${l.costTypeName}`);
  if (l.materialGroupName) parts.push(`раздел: ${l.materialGroupName}`);
  if (l.workNames.length) parts.push(`работы: ${l.workNames.slice(0, 3).join('; ')}`);
  return parts.join(' · ');
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function buildBatchUserPrompt(batch: GroupingBatch): string {
  const lines = batch.lines.map((l, i) => lineText(l, i + 1)).join('\n');
  return `Материалы (формат: idx|наименование|ед|количество · контекст):\n${lines}\n\nСгруппируй по производственным операциям. Верни только JSON.`;
}

/**
 * Второй проход: слить черновые группы, описывающие одну операцию, но разошедшиеся по наборам.
 * Модель видит карточки групп с их составом (название, назначение, примеры материалов, работы) —
 * без idx строк: на большой смете эхо ключей раздуло бы промпт reduce больше самого map.
 *
 * Для объединённой группы модель обязана вернуть пересмотренную оценку: две неполные половины
 * вместе могут составить комплект, и наследовать «худшее из двух» было бы неверно.
 */
export function buildMergeUserPrompt(groups: DraftGroup[], linesByKey: Map<string, GroupingLine>): string {
  const cards = groups
    .map((g) => {
      const mats = g.orderKeys
        .map((k) => linesByKey.get(k)?.name)
        .filter((n): n is string => !!n)
        .slice(0, 5)
        .join('; ');
      const works = [...new Set(g.orderKeys.flatMap((k) => linesByKey.get(k)?.workNames ?? []))].slice(0, 3).join('; ');
      return `${g.id}|${g.name}|${g.purpose ?? ''}|позиций: ${g.orderKeys.length}|материалы: ${mats}|работы: ${works}`;
    })
    .join('\n');
  return (
    `Черновые группы (формат: id|название|назначение|число позиций|материалы|работы):\n${cards}\n\n` +
    `Объедини группы, которые описывают ОДНУ И ТУ ЖЕ производственную операцию (их разнесло по наборам). ` +
    `Разные операции (например «Монтаж трубопровода» и «Изоляция трубопровода») не объединяй. ` +
    `Для каждого объединения верни пересмотренную оценку итоговой группы. Верни только JSON:\n` +
    `{"merge":[{"into":"<id>","from":["<id>"],"name":"итоговое название","purpose":"назначение",` +
    `"completeness":"complete|incomplete|unknown","compatibility":"no_issues|possible_issue|unknown"}]}\n` +
    `Если объединять нечего — {"merge":[]}.`
  );
}
