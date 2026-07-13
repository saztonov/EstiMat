import JSZip from 'jszip';

// ExcelJS при сохранении добавляет невалидный атрибут `operator` к правилам условного
// форматирования типа containsBlanks/containsErrors (в схеме OOXML у таких правил
// operator быть не должно). Excel такое обычно открывает, но строгие парсеры (openpyxl,
// иногда сам Excel с диалогом «восстановить») спотыкаются. Точечно удаляем атрибут в
// worksheet-XML готового файла, остальное не трогаем.
const BAD_OPERATOR = / operator="(?:containsBlanks|notContainsBlanks|containsErrors|notContainsErrors)"/g;

// ExcelJS вычисляет collapsed из outlineLevel >= outlineLevelRow (lib/doc/row.js) и пишет
// collapsed="1" на строки самого глубокого уровня (у нас — материалы). В экспорте все группы
// должны открываться развёрнутыми (в исходной форме collapsed у строк не было), поэтому снимаем
// флаг, сохраняя сам outlineLevel. Легитимных collapsed в файле нет — чистим по всем листам.
const BAD_COLLAPSED = / collapsed="1"/g;

// Правая граница данных листов-справочников — колонка G (7).
const CROP_LAST_COL = 'G';
const CROP_LAST_COL_NUM = 7;

// Обрезать used range листа-справочника до A1:G{lastRow}: ExcelJS-очистка стилей убирает видимое
// оформление, но dimension/лишние определения колонок/пустые строки остаются, и Ctrl+End улетает
// в Z977. Правим готовый worksheet-XML: dimension, определения колонок правее G и строки ниже
// lastRow. Merge справочников — только в шапке (строки ≤3), границу обрезки не пересекают.
function cropSheetXml(xml: string, lastRow: number): string {
  // 1) dimension → A1:G{lastRow}
  let out = xml.replace(/(<dimension ref=")[^"]*("\s*\/?>)/, `$1A1:${CROP_LAST_COL}${lastRow}$2`);
  // 2) удалить определения колонок правее G (min>7)
  out = out.replace(/<col\b[^>]*\/>/g, (col) => {
    const min = Number(/min="(\d+)"/.exec(col)?.[1] ?? '0');
    return min > CROP_LAST_COL_NUM ? '' : col;
  });
  out = out.replace(/<cols>\s*<\/cols>/g, '');
  // 3) удалить строки ниже lastRow — сперва самозакрытые <row .../>, затем парные <row>…</row>
  out = out.replace(/<row\b[^>]*\/>/g, (row) => {
    const r = Number(/\br="(\d+)"/.exec(row)?.[1] ?? '0');
    return r > lastRow ? '' : row;
  });
  out = out.replace(/<row\b[^>]*?>[\s\S]*?<\/row>/g, (row) => {
    const r = Number(/\br="(\d+)"/.exec(row)?.[1] ?? '0');
    return r > lastRow ? '' : row;
  });
  return out;
}

// Сопоставить имя листа → путь worksheet-XML (через workbook.xml + rels): имена листов известны
// коду (МАТЕРИАЛЫ/РАБОТЫ), а crop делается по файлам xl/worksheets/sheetN.xml.
async function resolveSheetPaths(zip: JSZip): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const wbXml = await zip.file('xl/workbook.xml')?.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!wbXml || !relsXml) return map;

  const relTarget = new Map<string, string>();
  for (const rel of relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = /Id="([^"]+)"/.exec(rel)?.[1];
    const target = /Target="([^"]+)"/.exec(rel)?.[1];
    if (id && target) relTarget.set(id, target);
  }
  for (const sheet of wbXml.match(/<sheet\b[^>]*\/?>/g) ?? []) {
    const name = /name="([^"]+)"/.exec(sheet)?.[1];
    const rid = /r:id="([^"]+)"/.exec(sheet)?.[1];
    if (!name || !rid) continue;
    const target = relTarget.get(rid);
    if (!target) continue;
    // Target вида "worksheets/sheet2.xml" (относительно xl/) или "/xl/worksheets/sheet2.xml".
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    map.set(decodeXmlName(name), path);
  }
  return map;
}

function decodeXmlName(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Постобработка готового .xlsx: снять невалидные атрибуты УФ (operator/collapsed) и, если передан
 * `crop` ({ имя листа → последняя значимая строка }), обрезать used range этих листов до A1:G{lastRow}.
 */
export async function sanitizeXlsx(buffer: Buffer, crop?: Record<string, number>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  const cropByPath = new Map<string, number>();
  if (crop && Object.keys(crop).length) {
    const sheetPaths = await resolveSheetPaths(zip);
    for (const [name, lastRow] of Object.entries(crop)) {
      const path = sheetPaths.get(name);
      if (path) cropByPath.set(path, lastRow);
    }
  }

  for (const path of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    const file = zip.files[path];
    if (!file) continue;
    const xml = await file.async('string');
    let fixed = xml.replace(BAD_OPERATOR, '').replace(BAD_COLLAPSED, '');
    const lastRow = cropByPath.get(path);
    if (lastRow != null) fixed = cropSheetXml(fixed, lastRow);
    if (fixed !== xml) zip.file(path, fixed);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
