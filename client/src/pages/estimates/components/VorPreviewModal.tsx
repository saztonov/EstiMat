import { useEffect, useState } from 'react';
import { Modal, Spin, Segmented, Alert, Button } from 'antd';
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

// Предпросмотр выгруженного ВОР прямо в приложении. HTML с форматированием (заливки, шрифты,
// границы, объединения) готовит сервер тем же ExcelJS, что генерировал файл, — значения ячеек
// html-эскейплены на сервере, инлайн-стили вычислены из модели, поэтому рендерим напрямую.
// Денежные колонки/итоги пусты — это невычисленные формулы (цены заполняет подрядчик).
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
        const res = await api.get<{ data: { sheets: SheetHtml[] } }>(
          `/estimates/${estimateId}/vors/${vor.id}/preview`,
          { signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        // Defense-in-depth: HTML уже эскейплен сервером, но санитизируем перед вставкой.
        // Дефолтный DOMPurify сохраняет table/colgroup/col, colspan/rowspan и инлайн-стили.
        const { default: DOMPurify } = await import('dompurify');
        if (ac.signal.aborted) return;
        const parsed = res.data.sheets.map((s) => ({ name: s.name, html: DOMPurify.sanitize(s.html) }));
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
              border: '1px solid var(--est-border)',
              borderRadius: 8,
            }}
            // HTML сформирован нашим сервером из ExcelJS-модели: значения ячеек html-эскейплены,
            // инлайн-стили вычислены из модели (пользовательского ввода в стилях нет).
            dangerouslySetInnerHTML={{ __html: current?.html ?? '' }}
          />
          <div style={{ marginTop: 8, color: 'var(--est-text-tertiary)', fontSize: 12 }}>
            Денежные колонки и итоги в предпросмотре пусты — цены заполняет подрядчик, а предпросмотр не
            пересчитывает формулы. Итоговые суммы доступны в скачанном файле.
          </div>
        </div>
      )}
    </Modal>
  );
}
