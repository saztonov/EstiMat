import { useEffect, useState } from 'react';
import { Modal, Spin, Segmented, Alert, Button } from 'antd';
import type { WorkSheet, CellObject } from 'xlsx';
import { api } from '../../../services/api';

interface Props {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  // Просматриваемый ВОР (id + имя для заголовка); null — модалка закрыта.
  vor: { id: string; name: string } | null;
}

interface SheetHtml {
  name: string;
  html: string;
}

// Лист «КП» — основной (шапка формы + таблица работ). Показываем его по умолчанию.
const MAIN_SHEET = 'КП';

// Сузить диапазон листа до фактических данных: пустой хвост строк (лист КП: ~1000 строк) и пустые
// правые колонки (лист МАТЕРИАЛЫ: до Z) раздувают DOM и добавляют лишние пустые колонки в предпросмотр.
// Учитываем объединённые ячейки — merge шапки/«хвоста» может простираться правее последней непустой.
function trimSheetRef(XLSX: typeof import('xlsx'), ws: WorkSheet): void {
  const ref = ws['!ref'];
  if (!ref) return;
  const full = XLSX.utils.decode_range(ref);
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(ws)) {
    if (key[0] === '!') continue;
    const cell = ws[key] as CellObject | undefined;
    if (cell == null || cell.v == null || cell.v === '') continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (maxR < 0 || maxC < 0) return;
  for (const m of ws['!merges'] ?? []) {
    if (m.e.r > maxR) maxR = m.e.r;
    if (m.e.c > maxC) maxC = m.e.c;
  }
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: full.s.r, c: full.s.c },
    e: { r: Math.min(full.e.r, maxR), c: Math.min(full.e.c, maxC) },
  });
}

// Ширины колонок из содержимого: sheet_to_html их не задаёт, а table-layout: auto делает текстовую
// «Наименование» узкой. Считаем макс. длину текста по колонке (игнорируя ячейки в горизонтальных
// объединениях — абзацы «хвоста» на 15 колонок не должны раздувать одну колонку), ограничиваем
// и переводим в проценты. Возвращаем <colgroup> для вставки в таблицу (table-layout: fixed в CSS).
const COL_MIN = 3;
const COL_MAX = 40;
function buildColgroup(XLSX: typeof import('xlsx'), ws: WorkSheet): string {
  const ref = ws['!ref'];
  if (!ref) return '';
  const range = XLSX.utils.decode_range(ref);
  const ncols = range.e.c - range.s.c + 1;
  if (ncols <= 0) return '';
  const spanned = new Set<string>();
  for (const m of ws['!merges'] ?? []) {
    if (m.e.c > m.s.c) {
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) spanned.add(`${r}:${c}`);
    }
  }
  const widths = new Array<number>(ncols).fill(COL_MIN);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (spanned.has(`${r}:${c}`)) continue;
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined;
      if (cell == null || cell.v == null || cell.v === '') continue;
      const len = String(cell.v).length;
      const ci = c - range.s.c;
      if (len > widths[ci]!) widths[ci] = Math.min(len, COL_MAX);
    }
  }
  const total = widths.reduce((a, b) => a + b, 0) || ncols;
  const cols = widths.map((w) => `<col style="width:${((w / total) * 100).toFixed(3)}%"/>`).join('');
  return `<colgroup>${cols}</colgroup>`;
}

// Предпросмотр выгруженного ВОР прямо в приложении: тянем xlsx как ArrayBuffer, парсим SheetJS
// (ленивый импорт — вне стартового бандла) и рендерим готовый HTML таблицы. Денежные колонки/итоги
// в файле — живые формулы без кэш-результата (цены заполняет подрядчик), поэтому в предпросмотре они
// пустые; полезные данные (локации, наименования, ед.изм., объёмы, примечания) — литеральные, видны.
export function VorPreviewModal({ open, onClose, estimateId, vor }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetHtml[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || !vor) {
      setSheets([]);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const buf = await api.getArrayBuffer(
          `/estimates/${estimateId}/vors/${vor.id}/file?disposition=inline`,
          { signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        // Ленивая загрузка вне стартового бандла: парсер SheetJS + санитайзер.
        const [XLSX, { default: DOMPurify }] = await Promise.all([import('xlsx'), import('dompurify')]);
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const parsed: SheetHtml[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name]!;
          trimSheetRef(XLSX, ws);
          // Вставляем <colgroup> с ширинами колонок в <table> перед санитайзером.
          const raw = XLSX.utils.sheet_to_html(ws).replace('<table>', `<table>${buildColgroup(XLSX, ws)}`);
          return { name, html: DOMPurify.sanitize(raw) };
        });
        if (ac.signal.aborted) return;
        setSheets(parsed);
        setActiveSheet(parsed.find((s) => s.name === MAIN_SHEET)?.name ?? parsed[0]?.name ?? '');
      } catch (e) {
        // Отмена при закрытии модалки (apiFetchRaw превращает AbortError в ApiError(0)) — не ошибка.
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Не удалось открыть файл');
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [open, vor, estimateId, reloadKey]);

  const current = sheets.find((s) => s.name === activeSheet);

  return (
    <Modal
      title={vor ? `Просмотр: ${vor.name}` : 'Просмотр ВОР'}
      open={open}
      onCancel={onClose}
      footer={null}
      width="90%"
      style={{ top: 24 }}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
          <Spin />
        </div>
      ) : error ? (
        <Alert
          type="error"
          showIcon
          message="Не удалось открыть файл"
          description={error}
          action={
            <Button size="small" onClick={() => setReloadKey((k) => k + 1)}>
              Повторить
            </Button>
          }
        />
      ) : (
        <div>
          {sheets.length > 1 && (
            <Segmented
              options={sheets.map((s) => s.name)}
              value={activeSheet}
              onChange={(v) => setActiveSheet(String(v))}
              style={{ marginBottom: 12 }}
            />
          )}
          <div
            className="estimat-xlsx-preview"
            style={{
              maxHeight: 'calc(100vh - 170px)',
              overflow: 'auto',
              border: '1px solid #f0f0f0',
              borderRadius: 8,
            }}
            // HTML санитизирован DOMPurify (см. загрузку выше); sheet_to_html к тому же html-экранирует
            // текст ячеек, а файл серверный (из нашей БД) — активный контент невозможен.
            dangerouslySetInnerHTML={{ __html: current?.html ?? '' }}
          />
          <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
            Денежные колонки и итоги в предпросмотре пусты — цены заполняет подрядчик, а предпросмотр не
            пересчитывает формулы. Итоговые суммы доступны в скачанном файле.
          </div>
        </div>
      )}
    </Modal>
  );
}
