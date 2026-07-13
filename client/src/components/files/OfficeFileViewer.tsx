import { useEffect, useState } from 'react';
import { Spin, Tabs, Empty } from 'antd';
import DOMPurify from 'dompurify';
import { extOf } from '../../lib/files';

interface Props {
  buffer: ArrayBuffer;
  fileName: string;
  height?: string;
}

interface Sheet { name: string; html: string }

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Безопасное текстовое значение ячейки ExcelJS: cell.text может кидать на некоторых типах
// (formula/richText/hyperlink/error/date) — обрабатываем cell.value вручную.
function cellText(cell: { value: unknown }): string {
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('ru-RU');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('');
    if ('text' in o && o.text != null) return String(o.text);       // hyperlink
    if ('result' in o) return o.result != null ? String(o.result) : ''; // formula
    if ('error' in o && o.error != null) return String(o.error);
    return '';
  }
  return String(v);
}

/** Рендер листа Excel через ExcelJS в HTML-таблицу с базовым форматированием (заливка/жирный/выравнивание). */
async function renderXlsx(buffer: ArrayBuffer): Promise<Sheet[]> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const colCount = Math.min(ws.actualColumnCount || ws.columnCount || 1, 60);
    let html = '<table>';
    ws.eachRow({ includeEmpty: true }, (row) => {
      html += '<tr>';
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        const text = cellText(cell);
        const fill = cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor?.argb
          ? `background:#${cell.fill.fgColor.argb.slice(-6)};` : '';
        const bold = cell.font?.bold ? 'font-weight:bold;' : '';
        const align = cell.alignment?.horizontal ? `text-align:${cell.alignment.horizontal};` : '';
        html += `<td style="${fill}${bold}${align}">${escapeHtml(String(text))}</td>`;
      }
      html += '</tr>';
    });
    html += '</table>';
    sheets.push({ name: ws.name, html });
  });
  return sheets;
}

/** Просмотр офисных документов: Excel (ExcelJS), старый xls (SheetJS), Word (mammoth). Lazy-import. */
export function OfficeFileViewer({ buffer, fileName, height = '70vh' }: Props) {
  const [loading, setLoading] = useState(true);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ext = extOf(fileName);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (ext === 'xlsx') {
          const list = await renderXlsx(buffer);
          if (!cancelled) setSheets(list);
        } else if (ext === 'xls') {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
          const list: Sheet[] = [];
          for (const n of wb.SheetNames) {
            const ws = wb.Sheets[n];
            if (ws) list.push({ name: n, html: XLSX.utils.sheet_to_html(ws, { editable: false }) });
          }
          if (!cancelled) setSheets(list);
        } else if (ext === 'docx') {
          const mammothMod = await import('mammoth');
          const mammoth = (mammothMod as unknown as { default?: typeof mammothMod }).default ?? mammothMod;
          const res = await mammoth.convertToHtml({ arrayBuffer: buffer });
          if (!cancelled) setSheets([{ name: 'Документ', html: res.value }]);
        } else {
          if (!cancelled) setError('Предпросмотр этого формата недоступен — скачайте файл.');
        }
      } catch (e) {
        if (!cancelled) setError('Не удалось открыть документ: ' + (e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [buffer, ext]);

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>;
  if (error) return <div style={{ padding: 48 }}><Empty description={error} /></div>;

  const render = (html: string) => (
    <div className="office-preview" style={{ height, overflow: 'auto', padding: 12, background: '#fff' }}>
      <style>{`.office-preview table{border-collapse:collapse}.office-preview td,.office-preview th{border:1px solid #e0e0e0;padding:2px 6px;font-size:13px;white-space:nowrap}`}</style>
      <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
    </div>
  );

  if (sheets.length <= 1) return render(sheets[0]?.html ?? '');
  return <Tabs items={sheets.map((s, i) => ({ key: String(i), label: s.name, children: render(s.html) }))} />;
}
