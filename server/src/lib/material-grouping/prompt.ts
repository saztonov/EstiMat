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

export const PROMPT_VERSION = 'mg-4';

/** Системный промпт = базовый текст из снимка задания. Границ больше нет — вид работ это affinity. */
export function buildSystemPrompt(baseText: string): string {
  return baseText;
}

/**
 * Строка для модели: idx + название + ед + количество + контекст происхождения.
 *
 * Подписи контекста однозначны: категория и вид работ — это разделы сметы, «группа материалов» —
 * раздел справочника. Раньше последняя звалась «раздел» и путалась с категорией сметы.
 */
function lineText(l: GroupingLine, idx: number): string {
  const parts = [`${idx}|${l.name}|${l.unit}|${round(l.quantity)}`];
  // Категория и вид работ — контекст происхождения (affinity), а не граница: помогают узнать
  // систему и стадию, но один комплект вправе собраться из разных видов работ.
  if (l.costCategoryName) parts.push(`категория: ${l.costCategoryName}`);
  if (l.costTypeName) parts.push(`вид работ: ${l.costTypeName}`);
  if (l.materialGroupName) parts.push(`группа материалов: ${l.materialGroupName}`);
  if (l.workNames.length) parts.push(`работы: ${l.workNames.slice(0, 3).join('; ')}`);
  return parts.join(' · ');
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function buildBatchUserPrompt(batch: GroupingBatch): string {
  const lines = batch.lines.map((l, i) => lineText(l, i + 1)).join('\n');
  return (
    `Материалы (формат: idx|наименование|ед|количество · контекст):\n${lines}\n\n` +
    `Собери комплекты заявки. Для каждой группы укажи stage. Верни только JSON.`
  );
}

/**
 * Второй проход: слить черновые группы, описывающие один комплект, но разошедшиеся по наборам.
 * Модель видит карточки групп с их составом (название, назначение, стадия, контекст, примеры
 * материалов, работы, текущая оценка) — без idx строк: на большой смете эхо ключей раздуло бы
 * промпт reduce больше самого map.
 *
 * Порядок карточек стабильный (категория → вид работ → стадия → название → id): однородное идёт
 * рядом, и один и тот же набор групп всегда подаётся одинаково, в каком бы порядке ни завершились
 * наборы.
 *
 * Для объединённой группы модель обязана вернуть пересмотренную оценку: две неполные половины
 * вместе могут составить комплект, и наследовать «худшее из двух» было бы неверно.
 */
export function buildMergeUserPrompt(groups: DraftGroup[], linesByKey: Map<string, GroupingLine>): string {
  const contextOf = (g: DraftGroup, pick: (l: GroupingLine) => string | null): string[] => [
    ...new Set(g.orderKeys.map((k) => (linesByKey.get(k) ? pick(linesByKey.get(k)!) : null)).filter((v): v is string => !!v)),
  ];

  const cards = [...groups]
    .map((g) => ({
      g,
      categories: contextOf(g, (l) => l.costCategoryName),
      costTypes: contextOf(g, (l) => l.costTypeName),
    }))
    .sort(
      (a, b) =>
        (a.categories[0] ?? '').localeCompare(b.categories[0] ?? '', 'ru') ||
        (a.costTypes[0] ?? '').localeCompare(b.costTypes[0] ?? '', 'ru') ||
        (a.g.stage ?? '').localeCompare(b.g.stage ?? '') ||
        a.g.name.localeCompare(b.g.name, 'ru') ||
        a.g.id.localeCompare(b.g.id),
    )
    .map(({ g, categories, costTypes }) => {
      const mats = g.orderKeys
        .map((k) => linesByKey.get(k)?.name)
        .filter((n): n is string => !!n)
        .slice(0, 5)
        .join('; ');
      const works = [...new Set(g.orderKeys.flatMap((k) => linesByKey.get(k)?.workNames ?? []))].slice(0, 3).join('; ');
      return (
        `${g.id}|${g.name}|${g.purpose ?? ''}|этап: ${g.stage ?? 'не указан'}|позиций: ${g.orderKeys.length}` +
        `|категории: ${categories.slice(0, 2).join('; ')}|виды работ: ${costTypes.slice(0, 3).join('; ')}` +
        `|оценка: ${g.completeness}/${g.compatibility}|материалы: ${mats}|работы: ${works}`
      );
    })
    .join('\n');

  return (
    `Черновые комплекты (формат: id|название|назначение|этап|число позиций|категории|виды работ|` +
    `оценка комплектности/совместимости|материалы|работы):\n${cards}\n\n` +
    `Объедини карточки, которые относятся к ОДНОМУ законченному результату и набираются в одну заявку ` +
    `до одного порога готовности. Разные виды работ объединению не мешают. Разные стадии готовности, ` +
    `самостоятельно принимаемые узлы, монтаж и защиту поверх него не объединяй. ` +
    `Для каждого объединения верни пересмотренную оценку итоговой группы. Верни только JSON:\n` +
    `{"merge":[{"into":"<id>","from":["<id>"],"name":"итоговое название","purpose":"законченный результат",` +
    `"stage":"prep|main|protection|finish|commissioning|other",` +
    `"completeness":"complete|incomplete|unknown","compatibility":"no_issues|possible_issue|unknown"}]}\n` +
    `Если объединять нечего — {"merge":[]}.`
  );
}
