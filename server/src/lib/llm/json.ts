/**
 * Разбор JSON-ответа модели. Единственная реализация на весь сервер: модели регулярно
 * оборачивают JSON в ```-блок или добавляют пояснения вокруг, и каждый потребитель
 * иначе изобретал бы свой парсер.
 */

/** Вырезать JSON (объект или массив) из текста ответа модели. null — не удалось. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const endArr = trimmed.lastIndexOf(']');
    const endObj = trimmed.lastIndexOf('}');
    const end = Math.max(endArr, endObj);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
