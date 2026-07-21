/**
 * Подготовка счёта к отправке в модель.
 *
 * Каждый формат идёт своим путём, и это не оптимизация, а условие точности:
 *   pdf        — файлом как есть, парсер выбирает OpenRouter (pdf-text). Рендер в картинку
 *                потерял бы точный текст у текстового PDF ради худшего OCR;
 *   jpg/png    — картинкой (image_url);
 *   xlsx       — таблицей в текст через ExcelJS: дёшево и точнее любого распознавания;
 *   xls        — НЕ поддерживается. ExcelJS не читает старый бинарный OLE2, а SheetJS с 2023 года
 *                не публикуется в npm (тарбол с CDN, история CVE) — плохой обмен ради редкого
 *                формата. Файл при этом сохраняется и открывается, реквизиты вводятся вручную;
 *   tiff/bmp/doc/docx — не поддерживаются моделью либо требуют конвертации.
 */
import ExcelJS from 'exceljs';
import type { ChatContentPart } from '../llm/openrouter.js';

/**
 * Потолок файла для распознавания. base64 раздувает объём на треть, и тело запроса целиком
 * держится в памяти; лимит ЗАГРУЗКИ при этом остаётся прежним (50 МБ) — большой счёт просто
 * не распознаётся, но сохраняется.
 */
export const RECOGNIZE_MAX_BYTES = 8 * 1024 * 1024;

/** Сколько таблицы отдаём модели: счёт с тысячами строк — это не счёт, а выгрузка. */
const XLSX_MAX_SHEETS = 5;
const XLSX_MAX_ROWS = 400;
const XLSX_MAX_COLS = 40;

export interface PreparedDocument {
  parts: ChatContentPart[];
  /** Провайдер-специфичные поля запроса (для PDF — выбор парсера). */
  extraBody?: Record<string, unknown>;
}

/** Формат распознать нельзя — это не сбой, а понятное пользователю ограничение. */
export class UnsupportedDocumentError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = 'UnsupportedDocumentError';
  }
}

const extOf = (fileName: string) => (fileName.split('.').pop() ?? '').toLowerCase();

/** Плоский текст книги Excel: лист → строки → ячейки через табуляцию. */
export async function xlsxToText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const out: string[] = [];
  let sheets = 0;
  for (const ws of wb.worksheets) {
    if (++sheets > XLSX_MAX_SHEETS) break;
    out.push(`# Лист: ${ws.name}`);
    let rows = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (++rows > XLSX_MAX_ROWS) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > XLSX_MAX_COLS) return;
        const v = cell.value;
        if (v == null) { cells.push(''); return; }
        if (typeof v === 'object' && 'result' in (v as object)) {
          cells.push(String((v as { result?: unknown }).result ?? ''));
        } else if (typeof v === 'object' && 'text' in (v as object)) {
          cells.push(String((v as { text?: unknown }).text ?? ''));
        } else if (v instanceof Date) {
          cells.push(v.toISOString().slice(0, 10));
        } else {
          cells.push(String(v));
        }
      });
      // Пустые строки таблицы модели ничего не дают, а бюджет тратят.
      if (cells.some((c) => c.trim())) out.push(cells.join('\t').replace(/\t+$/, ''));
    });
  }
  return out.join('\n');
}

export async function prepareInvoiceDocument(
  buf: Buffer,
  fileName: string,
): Promise<PreparedDocument> {
  if (buf.byteLength > RECOGNIZE_MAX_BYTES) {
    throw new UnsupportedDocumentError('Файл больше 8 МБ — распознавание пропущено, заполните реквизиты вручную');
  }
  const ext = extOf(fileName);

  if (ext === 'pdf') {
    return {
      parts: [{
        type: 'file',
        file: { filename: fileName, file_data: `data:application/pdf;base64,${buf.toString('base64')}` },
      }],
      // pdf-text бесплатен и точен на текстовых PDF; платный OCR включать по умолчанию нельзя.
      extraBody: { plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }] },
    };
  }

  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return {
      parts: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } }],
    };
  }

  if (ext === 'xlsx') {
    const text = await xlsxToText(buf);
    if (!text.trim()) throw new UnsupportedDocumentError('Не удалось прочитать таблицу — заполните реквизиты вручную');
    return { parts: [{ type: 'text', text: `Содержимое файла ${fileName}:\n\n${text}` }] };
  }

  if (ext === 'xls') {
    throw new UnsupportedDocumentError('Старый формат .xls не распознаётся — пересохраните в .xlsx или приложите PDF');
  }
  if (ext === 'tif' || ext === 'tiff' || ext === 'bmp') {
    throw new UnsupportedDocumentError('Этот формат изображения не распознаётся — приложите PDF, JPG или PNG');
  }
  throw new UnsupportedDocumentError('Формат файла не распознаётся — приложите PDF, JPG, PNG или XLSX');
}
