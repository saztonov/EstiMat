/**
 * Общие проверки и потоковая загрузка файлов в S3 (переиспользуется заявками и заявками на оплату).
 * MIME выводится сервером из проверенного расширения — клиентскому content-type не доверяем.
 * Загрузка потоковая (managed multipart), без буферизации крупных файлов в память: первые байты
 * читаются для sniff magic-bytes, затем остаток стримится в S3; checksum считается на лету.
 */
import { createHash, randomUUID } from 'node:crypto';
import { PassThrough, type Readable } from 'node:stream';
import type { Storage } from '../../plugins/s3.js';

// Разрешённые типы файлов + сигнатуры (magic bytes) — документы, не изображения проекта.
export const ALLOWED_EXT = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp',
]);

export const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
};

export function sniffOk(buf: Buffer, ext: string): boolean {
  const b = buf;
  const starts = (sig: number[]) => sig.every((x, i) => b[i] === x);
  if (ext === 'pdf') return starts([0x25, 0x50, 0x44, 0x46]); // %PDF
  if (ext === 'png') return starts([0x89, 0x50, 0x4e, 0x47]);
  if (ext === 'jpg' || ext === 'jpeg') return starts([0xff, 0xd8, 0xff]);
  if (ext === 'bmp') return starts([0x42, 0x4d]);
  if (ext === 'tif' || ext === 'tiff') return starts([0x49, 0x49, 0x2a, 0x00]) || starts([0x4d, 0x4d, 0x00, 0x2a]);
  if (ext === 'docx' || ext === 'xlsx') return starts([0x50, 0x4b, 0x03, 0x04]); // zip (OOXML)
  if (ext === 'doc' || ext === 'xls') return starts([0xd0, 0xcf, 0x11, 0xe0]); // OLE2
  return false;
}

export function extOf(fileName: string): string {
  return (fileName.split('.').pop() ?? '').toLowerCase();
}

/** Безопасное имя файла: только буквы/цифры/точка/дефис/пробел (лат+кир), обрезка длины. */
export function safeFileName(name: string): string {
  return name.replace(/[^\w.\-а-яА-ЯёЁ ]+/g, '_').slice(0, 200);
}

export class FileGuardError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'FileGuardError';
    this.status = status;
  }
}

/** Читает первый непустой чанк из потока (для sniff), не теряя его для последующей передачи. */
function readFirstChunk(src: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onReadable = () => {
      const chunk = src.read();
      if (chunk) {
        cleanup();
        resolve(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    };
    const onEnd = () => { cleanup(); resolve(Buffer.alloc(0)); };
    const onError = (e: Error) => { cleanup(); reject(e); };
    const cleanup = () => {
      src.off('readable', onReadable);
      src.off('end', onEnd);
      src.off('error', onError);
    };
    src.on('readable', onReadable);
    src.on('end', onEnd);
    src.on('error', onError);
  });
}

/**
 * Потоково загружает файл multipart в S3 с проверкой magic-bytes и подсчётом checksum/size.
 * @param source   поток файла (Fastify multipart `file.file`)
 * @param fileName исходное имя (для расширения)
 * @param keyPrefix префикс ключа S3 (напр. `material-requests/<id>`)
 * @returns метаданные для записи в БД
 */
export async function guardedStreamUpload(
  storage: Storage,
  source: Readable,
  fileName: string,
  keyPrefix: string,
): Promise<{ key: string; mime: string; checksum: string; size: number; safeName: string }> {
  const ext = extOf(fileName);
  if (!ALLOWED_EXT.has(ext)) throw new FileGuardError('Недопустимый тип файла');

  const firstChunk = await readFirstChunk(source);
  if (!sniffOk(firstChunk, ext)) {
    source.resume(); // осушить остаток, чтобы не подвесить соединение
    throw new FileGuardError('Содержимое файла не соответствует расширению');
  }

  const mime = EXT_TO_MIME[ext] ?? 'application/octet-stream';
  const safeName = safeFileName(fileName);
  const key = `${keyPrefix}/${randomUUID()}_${safeName}`;

  // Собираем поток заново: первый чанк + остаток; попутно считаем hash и размер.
  const hash = createHash('sha256');
  let size = 0;
  const pass = new PassThrough();
  pass.on('data', (c: Buffer) => { hash.update(c); size += c.length; });

  const pump = (async () => {
    pass.write(firstChunk);
    for await (const chunk of source) pass.write(chunk as Buffer);
    pass.end();
  })();

  await Promise.all([storage.putObjectStream(key, pass, mime), pump]);

  return { key, mime, checksum: hash.digest('hex'), size, safeName };
}
