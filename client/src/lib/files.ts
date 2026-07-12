/** Человекочитаемый размер файла. */
export function formatSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff', webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** MIME по имени файла (когда серверный mime отсутствует/ненадёжен). */
export function mimeFromName(name: string): string {
  return EXT_MIME[extOf(name)] ?? 'application/octet-stream';
}

export function resolveMime(name: string, mime?: string | null): string {
  if (mime && mime !== 'application/octet-stream') return mime;
  return mimeFromName(name);
}

export const isImageMime = (m: string) => m.startsWith('image/');
export const isPdfMime = (m: string) => m === 'application/pdf';
export const isExcelMime = (m: string, name?: string) =>
  m.includes('spreadsheet') || m === 'application/vnd.ms-excel' ||
  (!!name && ['xlsx', 'xls'].includes(extOf(name)));
export const isWordMime = (m: string, name?: string) =>
  m.includes('wordprocessing') || m === 'application/msword' ||
  (!!name && ['docx', 'doc'].includes(extOf(name)));
export const isOfficeMime = (m: string, name?: string) => isExcelMime(m, name) || isWordMime(m, name);
