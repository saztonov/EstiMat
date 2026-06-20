/**
 * Лёгкий парсер GFM-markdown в типизированные блоки (заголовки/таблицы/параграфы).
 * Без внешних зависимостей: распознанный РД из портала RDLOCAL — это в основном
 * GFM-таблицы с `|` под заголовками разделов. Нам нужны таблицы + контекст секции.
 */
import type { RawBlock } from './types.js';

const MAX_SNIPPET = 4000;

/** Строка-разделитель GFM-таблицы: |---|:--:|---| и т.п. */
function isTableDelimiter(line: string): boolean {
  const t = line.trim();
  if (!t.includes('-')) return false;
  // Только из | : - и пробелов, и есть хотя бы один дефис.
  return /^\|?[\s:|-]+\|?$/.test(t) && /-/.test(t);
}

/** Похоже ли на строку GFM-таблицы (есть разделители ячеек). */
function looksLikeTableRow(line: string): boolean {
  return line.includes('|');
}

/** Разбор строки таблицы на ячейки (с учётом ведущего/замыкающего |). */
function splitCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function snippet(lines: string[], sectionPath: string[]): string {
  const head = sectionPath.length ? `# ${sectionPath[sectionPath.length - 1]}\n` : '';
  const body = lines.join('\n');
  return (head + body).slice(0, MAX_SNIPPET);
}

/** Служебный заголовок-каркас RDLOCAL (не является контекстом раздела). */
function isScaffoldingHeading(level: number, text: string): boolean {
  if (level === 1) return true; // H1 — путь/название документа (хлебные крошки)
  const t = text.trim();
  if (/^СТРАНИЦА\s+\d+/i.test(t)) return true;
  if (/^BLOCK\s*\[/i.test(t)) return true;
  if (/^РАБОЧАЯ ДОКУМЕНТАЦИЯ$/i.test(t)) return true;
  return false;
}

export function parseMarkdown(markdown: string): RawBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: RawBlock[] = [];
  // Стек заголовков: [{level, text}] — формирует sectionPath.
  const headingStack: { level: number; text: string }[] = [];

  const sectionPath = () => headingStack.map((h) => h.text);

  let i = 0;
  let paragraphBuf: string[] = [];
  let paragraphStart = 0;

  const flushParagraph = () => {
    let text = paragraphBuf.join('\n').trim();
    if (text) {
      // Параграф-«Текст на чертеже» — распознанный текст блока-изображения
      // (часто строчная спецификация оборудования). Помечаем и снимаем маркер.
      let isDrawingText = false;
      const m = text.match(/^\*\*\s*Текст на чертеже:?\s*\*\*\s*/i);
      if (m) {
        isDrawingText = true;
        text = text.slice(m[0].length).trim();
      }
      blocks.push({
        type: 'paragraph',
        text,
        sectionPath: sectionPath(),
        sourceSnippet: snippet(paragraphBuf, sectionPath()),
        line: paragraphStart,
        ...(isDrawingText ? { isDrawingText: true } : {}),
      });
    }
    paragraphBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Заголовок ATX (# .. ######)
    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushParagraph();
      const level = (heading[1] ?? '#').length;
      const text = (heading[2] ?? '').trim();
      // Служебные заголовки RDLOCAL — не контекст раздела: H1-путь документа,
      // «СТРАНИЦА N», «BLOCK [TYPE]: id», шапка «РАБОЧАЯ ДОКУМЕНТАЦИЯ». Игнорируем
      // (в sectionPath/digest/названия не попадают), контент под ними остаётся.
      if (isScaffoldingHeading(level, text)) {
        i++;
        continue;
      }
      let top = headingStack[headingStack.length - 1];
      while (top && top.level >= level) {
        headingStack.pop();
        top = headingStack[headingStack.length - 1];
      }
      headingStack.push({ level, text });
      blocks.push({ type: 'heading', level, text, line: i });
      i++;
      continue;
    }

    // GFM-таблица: строка с | и следом строка-разделитель.
    const delim = lines[i + 1];
    if (looksLikeTableRow(line) && delim !== undefined && isTableDelimiter(delim)) {
      flushParagraph();
      const startLine = i;
      const headers = splitCells(line);
      const rawLines = [line, delim];
      i += 2;
      const rows: string[][] = [];
      let cur = lines[i];
      while (cur !== undefined && looksLikeTableRow(cur) && cur.trim() !== '') {
        if (isTableDelimiter(cur)) {
          i++;
          cur = lines[i];
          continue;
        }
        const cells = splitCells(cur);
        // Игнорируем полностью пустые строки-разделители.
        if (cells.some((c) => c !== '')) rows.push(cells);
        rawLines.push(cur);
        i++;
        cur = lines[i];
      }
      blocks.push({
        type: 'table',
        headers,
        rows,
        sectionPath: sectionPath(),
        sourceSnippet: snippet(rawLines, sectionPath()),
        startLine,
      });
      continue;
    }

    // Пустая строка — конец параграфа.
    if (trimmed === '') {
      flushParagraph();
      i++;
      continue;
    }

    // Накопление параграфа.
    if (paragraphBuf.length === 0) paragraphStart = i;
    paragraphBuf.push(line);
    i++;
  }

  flushParagraph();
  return blocks;
}
