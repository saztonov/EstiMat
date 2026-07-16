/**
 * Промпты умной группировки.
 *
 * Тексты по умолчанию (system и merge) вынесены в общий владелец lib/llm/prompts.ts и
 * редактируются в администрировании; здесь остаётся только сборка промпта из базового текста и
 * динамического блока границ, а также построение пользовательских промптов с данными.
 *
 * Базовый текст группировки задаётся ИЗ СНИМКА задания (payload.snapshot.groupingSystem): он
 * резолвится один раз при создании задания и входит в input_hash, поэтому правка текста
 * инвалидирует кэш, а resume/retry работают на том же тексте, что и первый прогон.
 *
 * PROMPT_VERSION — базовая версия формата промпта; фактический отпечаток (полный хэш текстов)
 * добавляется к ней при вычислении input_hash (см. routes/material-grouping/index.ts).
 */
import type { GroupingBatch, GroupingLine, GroupingSettings, DraftGroup } from './types.js';

export const PROMPT_VERSION = 'mg-2';

// Выключенный параметр не должен ни разделять материалы, ни считаться ошибкой. Самая надёжная
// защита — не показывать его модели вовсе (см. buildBatchUserPrompt), плюс явный запрет здесь.
function settingsNote(s: GroupingSettings): string {
  const notes: string[] = [];
  notes.push(
    s.costType
      ? 'Материалы разных видов работ объединять НЕЛЬЗЯ.'
      : 'Вид работ НЕ является основанием для разделения: материалы разных видов работ можно объединять, если они относятся к одной операции. Различие вида работ — не ошибка и не повод для issues.',
  );
  notes.push(
    s.location
      ? 'Материалы разных местоположений объединять НЕЛЬЗЯ.'
      : 'Местоположение НЕ является основанием для разделения. Различие местоположений — не ошибка.',
  );
  notes.push(
    s.locationType
      ? 'Материалы разных типов работ объединять НЕЛЬЗЯ.'
      : 'Тип работы (РП-1, МОП, ТПУ и т. п.) НЕ является основанием для разделения. Различие типов — не ошибка.',
  );
  return `ПРАВИЛА ГРАНИЦ:\n${notes.map((n) => `- ${n}`).join('\n')}`;
}

/** Системный промпт = базовый текст (из снимка задания) + динамический блок границ. */
export function buildSystemPrompt(s: GroupingSettings, baseText: string): string {
  return `${baseText}\n\n${settingsNote(s)}`;
}

/** Строка для модели: idx + всё, что разрешено настройками. */
function lineText(l: GroupingLine, idx: number, s: GroupingSettings): string {
  const parts = [`${idx}|${l.name}|${l.unit}|${round(l.quantity)}`];
  if (s.costType && l.costTypeName) parts.push(`вид работ: ${l.costTypeName}`);
  if (s.location && l.locationLabels.length) parts.push(`место: ${l.locationLabels.join(', ')}`);
  if (s.locationType && l.typeLabels.length) parts.push(`тип: ${l.typeLabels.join(', ')}`);
  if (l.materialGroupName) parts.push(`раздел: ${l.materialGroupName}`);
  if (l.workNames.length) parts.push(`работы: ${l.workNames.slice(0, 3).join('; ')}`);
  return parts.join(' · ');
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function buildBatchUserPrompt(batch: GroupingBatch, s: GroupingSettings): string {
  const lines = batch.lines.map((l, i) => lineText(l, i + 1, s)).join('\n');
  return `Материалы (формат: idx|наименование|ед|количество · контекст):\n${lines}\n\nСгруппируй по производственным операциям. Верни только JSON.`;
}

/**
 * Второй проход: слить черновые группы одной партиции, разъехавшиеся по батчам. Модель видит
 * только карточки групп (id, назначение, состав) — строки сюда не передаются, иначе на 576
 * позициях промпт reduce был бы больше, чем весь map.
 */
export function buildMergeUserPrompt(groups: DraftGroup[]): string {
  const cards = groups
    .map((g) => {
      const sample = g.orderKeys.length;
      return `${g.id}|${g.name}|${g.purpose ?? ''}|позиций: ${sample}`;
    })
    .join('\n');
  return `Черновые группы одной области (формат: id|название|назначение|число позиций):\n${cards}\n\nОбъедини группы, которые описывают ОДНУ И ТУ ЖЕ производственную операцию (их разнесло по разным наборам). Не объединяй разные операции. Верни только JSON:\n{"merge":[{"into":"<id>","from":["<id>","<id>"],"name":"итоговое название"}]}\nЕсли объединять нечего — {"merge":[]}.`;
}
// Системный промпт слияния (MERGE) — дефолт живёт в lib/llm/prompts.ts (ключ 'grouping.merge'),
// фактический текст берётся из снимка задания.
