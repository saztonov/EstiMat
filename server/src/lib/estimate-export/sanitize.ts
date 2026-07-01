import JSZip from 'jszip';

// ExcelJS при сохранении добавляет невалидный атрибут `operator` к правилам условного
// форматирования типа containsBlanks/containsErrors (в схеме OOXML у таких правил
// operator быть не должно). Excel такое обычно открывает, но строгие парсеры (openpyxl,
// иногда сам Excel с диалогом «восстановить») спотыкаются. Точечно удаляем атрибут в
// worksheet-XML готового файла, остальное не трогаем.
const BAD_OPERATOR = / operator="(?:containsBlanks|notContainsBlanks|containsErrors|notContainsErrors)"/g;

export async function sanitizeXlsx(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const path of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    const file = zip.files[path];
    if (!file) continue;
    const xml = await file.async('string');
    const fixed = xml.replace(BAD_OPERATOR, '');
    if (fixed !== xml) zip.file(path, fixed);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
