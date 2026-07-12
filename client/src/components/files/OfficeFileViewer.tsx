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

/** Просмотр офисных документов в браузере: Excel (SheetJS) и Word (mammoth), lazy-import. */
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
        if (ext === 'xlsx' || ext === 'xls') {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buffer, { type: 'array' });
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
      <style>{`.office-preview table{border-collapse:collapse}.office-preview td,.office-preview th{border:1px solid #e0e0e0;padding:2px 6px;font-size:13px}`}</style>
      <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
    </div>
  );

  if (sheets.length <= 1) return render(sheets[0]?.html ?? '');
  return <Tabs items={sheets.map((s, i) => ({ key: String(i), label: s.name, children: render(s.html) }))} />;
}
