/**
 * QR-код письма РП: PayHub отдаёт его как SVG (data:image/svg+xml;base64,...). Для вставки в
 * документы удобнее PNG — конвертируем через canvas. При ошибке рисования вызывающий код падает
 * на исходный SVG.
 */

/** Размер стороны PNG (QR — вектор, масштабируется без потери качества). */
const DEFAULT_PNG_SIZE = 512;

/** SVG data-URL → PNG data-URL. Бросает ошибку, если canvas недоступен/загрязнён. */
export async function svgDataUrlToPngDataUrl(svgDataUrl: string, size = DEFAULT_PNG_SIZE): Promise<string> {
  const img = new Image();
  img.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Не удалось загрузить SVG QR-кода'));
  });
  img.src = svgDataUrl;
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D-контекст недоступен');
  // Белая подложка — QR может быть без фона (прозрачный SVG). Литеральный белый, а не переменная
  // темы: картинка уходит в файл/печать, где тёмный фон сделал бы код нечитаемым сканером,
  // и Canvas всё равно не понимает CSS-переменные.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  return canvas.toDataURL('image/png');
}

/** Скачивание data-URL как файла (клик по временной ссылке). */
export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
