// Рендер сохранённого .xlsx-ВОР в HTML с форматированием — для предпросмотра в приложении.
//
// sheet_to_html (SheetJS) на клиенте стили не переносит. Здесь читаем файл тем же ExcelJS,
// что его сгенерировал (стили гидрируются 1:1: заливки, шрифты, границы, выравнивание,
// объединения, ширины), и строим HTML-таблицу с инлайн-стилями. Значения ячеек html-эскейпятся;
// инлайн-стили вычисляются из модели (пользовательского ввода в стилях нет) — рендерится напрямую.
//
// Денежные колонки/итоги в предпросмотре пусты: это невычисленные формулы (ExcelJS файл не
// пересчитывает) — показываем структуру, тексты, объёмы, ед.изм. и оформление.

import ExcelJS from 'exceljs';

export interface PreviewSheet {
  name: string;
  html: string;
}

const MAX_COL = 15; // форма ВОР не шире колонки O

// Палитра темы шаблона (Office): theme index → RRGGBB. Шаблон использует прямой argb почти везде;
// тема встречается лишь как белый (0/2) и чёрный (1/3) в шрифтах/фонах.
const THEME_HEX = [
  'FFFFFF', '000000', 'FFFFFF', '000000', '5B9BD5', 'ED7D31',
  'A5A5A5', 'FFC000', '4472C4', '70AD47', '0563C1', '954F72',
];

type ExcelColor = Partial<ExcelJS.Color> & { theme?: number; tint?: number };

function colorCss(color?: ExcelColor): string | null {
  if (!color) return null;
  if (color.argb) return '#' + color.argb.slice(-6);
  if (typeof color.theme === 'number') return '#' + (THEME_HEX[color.theme] ?? '000000');
  return null;
}

function fillCss(fill?: ExcelJS.Fill): string | null {
  if (!fill || fill.type !== 'pattern') return null;
  const pf = fill as ExcelJS.FillPattern;
  if (pf.pattern !== 'solid' || !pf.fgColor) return null;
  return colorCss(pf.fgColor);
}

function borderWidth(style?: string): string {
  if (style === 'medium' || style === 'dashed' || style === 'dotted') return '2px';
  if (style === 'thick' || style === 'double') return '3px';
  return '1px'; // thin, hair, прочее
}

const HTML_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => HTML_ESCAPE[c]!);
}

// Форматирование числа по коду numFmt (нужны лишь несколько форматов формы: 0.00, #,##0.00, 0).
// Десятичный разделитель — запятая, тысячи — пробел (как в российском Excel).
function formatNum(v: number, numFmt?: string): string {
  if (!numFmt || numFmt === 'General' || numFmt === '@') {
    return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  }
  const dec = /0\.(0+)/.exec(numFmt);
  const digits = dec ? dec[1]!.length : 0;
  const fixed = v.toFixed(digits);
  const neg = fixed.startsWith('-');
  const abs = neg ? fixed.slice(1) : fixed;
  const dot = abs.indexOf('.');
  let intPart = dot >= 0 ? abs.slice(0, dot) : abs;
  const frac = dot >= 0 ? abs.slice(dot + 1) : '';
  if (numFmt.includes('#,#')) intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + intPart + (digits > 0 ? ',' + frac : '');
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'number') return formatNum(v, cell.numFmt);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ';
  if (v instanceof Date) return cell.text ?? '';
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('formula' in o || 'sharedFormula' in o) {
      const r = o.result;
      if (r == null || (typeof r === 'object' && r !== null && 'error' in r)) return '';
      return typeof r === 'number' ? formatNum(r, cell.numFmt) : String(r);
    }
    if ('error' in o) return '';
    if ('hyperlink' in o) return String(o.text ?? o.hyperlink ?? '');
    if ('text' in o) return String(o.text);
  }
  return '';
}

function cellCss(cell: ExcelJS.Cell): string {
  const p: string[] = [];
  const bg = fillCss(cell.fill);
  if (bg) p.push(`background-color:${bg}`);
  const f = cell.font;
  if (f) {
    const c = colorCss(f.color as ExcelColor | undefined);
    if (c) p.push(`color:${c}`);
    if (f.bold) p.push('font-weight:bold');
    if (f.italic) p.push('font-style:italic');
    if (f.underline) p.push('text-decoration:underline');
    if (f.size) p.push(`font-size:${f.size}pt`);
    if (f.name) p.push(`font-family:'${f.name.replace(/['"\\]/g, '')}'`);
  }
  const b = cell.border;
  if (b) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const bd = b[side];
      if (bd?.style) p.push(`border-${side}:${borderWidth(bd.style)} solid ${colorCss(bd.color as ExcelColor) ?? '#000'}`);
    }
  }
  const a = cell.alignment;
  if (a?.horizontal && a.horizontal !== 'fill' && a.horizontal !== 'justify') p.push(`text-align:${a.horizontal}`);
  else if (a?.horizontal) p.push('text-align:left');
  p.push(`vertical-align:${a?.vertical === 'top' ? 'top' : a?.vertical === 'bottom' ? 'bottom' : 'middle'}`);
  // Всегда переносим (даже без wrapText): предпросмотр не должен расползаться вширь.
  p.push('white-space:pre-wrap;overflow-wrap:break-word');
  return p.join(';');
}

function colNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// master-адрес → colspan/rowspan; множество подчинённых ячеек merge (их не рендерим).
function parseMerges(ws: ExcelJS.Worksheet): {
  spans: Map<string, { colspan: number; rowspan: number }>;
  slaves: Set<string>;
} {
  const spans = new Map<string, { colspan: number; rowspan: number }>();
  const slaves = new Set<string>();
  const merges = ((ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? []) as string[];
  for (const m of merges) {
    const mm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
    if (!mm) continue;
    const l = colNum(mm[1]!);
    const t = +mm[2]!;
    const r = colNum(mm[3]!);
    const b = +mm[4]!;
    spans.set(`${t}:${l}`, { colspan: r - l + 1, rowspan: b - t + 1 });
    for (let rr = t; rr <= b; rr++)
      for (let cc = l; cc <= r; cc++) if (!(rr === t && cc === l)) slaves.add(`${rr}:${cc}`);
  }
  return { spans, slaves };
}

function renderSheet(ws: ExcelJS.Worksheet): string {
  const dim = ws.dimensions;
  if (!dim || dim.bottom < dim.top) return '<table></table>';
  const lastRow = dim.bottom;

  // Последняя значимая колонка — по непустым значениям (обрезает пустые правые колонки), кап на O.
  let lastCol = 1;
  for (let r = dim.top; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.min(dim.right, MAX_COL); c++) {
      const val = row.getCell(c).value;
      if (val != null && val !== '' && c > lastCol) lastCol = c;
    }
  }

  const { spans, slaves } = parseMerges(ws);

  const widths: number[] = [];
  for (let c = 1; c <= lastCol; c++) widths.push(ws.getColumn(c).width ?? 14.43);
  const totalW = widths.reduce((a, b) => a + b, 0) || lastCol;
  const colgroup =
    '<colgroup>' +
    widths.map((w) => `<col style="width:${((w / totalW) * 100).toFixed(3)}%"/>`).join('') +
    '</colgroup>';

  let html =
    `<table style="border-collapse:collapse;table-layout:fixed;width:100%;` +
    `font-family:'Times New Roman',serif;font-size:11pt">` +
    colgroup;

  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    html += '<tr>';
    for (let c = 1; c <= lastCol; c++) {
      if (slaves.has(`${r}:${c}`)) continue;
      const cell = row.getCell(c);
      const span = spans.get(`${r}:${c}`);
      const attrs = span ? ` colspan="${span.colspan}" rowspan="${span.rowspan}"` : '';
      html += `<td${attrs} style="${cellCss(cell)}">${escapeHtml(cellText(cell))}</td>`;
    }
    html += '</tr>';
  }
  return html + '</table>';
}

/** Отрендерить все листы .xlsx-ВОР в styled HTML для предпросмотра. */
export async function renderXlsxPreview(buffer: Buffer): Promise<PreviewSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheets: PreviewSheet[] = [];
  wb.eachSheet((ws) => {
    sheets.push({ name: ws.name, html: renderSheet(ws) });
  });
  return sheets;
}
