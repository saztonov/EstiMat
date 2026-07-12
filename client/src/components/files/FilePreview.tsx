import { useEffect, useState } from 'react';
import { Modal, Spin, Image, Empty, App } from 'antd';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { resolveMime, isImageMime, isPdfMime, isOfficeMime } from '../../lib/files';
import { OfficeFileViewer } from './OfficeFileViewer';

/** Рендер содержимого превью по буферу файла. objectURL освобождается при размонтировании. */
function PreviewBody({ buffer, fileName, mimeType }: { buffer: ArrayBuffer; fileName: string; mimeType?: string | null }) {
  const mime = resolveMime(fileName, mimeType);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isImageMime(mime) || isPdfMime(mime)) {
      const u = URL.createObjectURL(new Blob([buffer], { type: mime }));
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setUrl(null);
  }, [buffer, mime]);

  if (isImageMime(mime)) {
    return url ? (
      <div style={{ textAlign: 'center' }}>
        <Image src={url} alt={fileName} style={{ maxWidth: '100%', maxHeight: '78vh' }} />
      </div>
    ) : null;
  }
  if (isPdfMime(mime)) {
    return url ? <iframe title={fileName} src={url} style={{ width: '100%', height: '80vh', border: 0 }} /> : null;
  }
  if (isOfficeMime(mime, fileName)) {
    return <OfficeFileViewer buffer={buffer} fileName={fileName} height="80vh" />;
  }
  return <div style={{ padding: 48 }}><Empty description="Предпросмотр этого формата недоступен — скачайте файл." /></div>;
}

/** Предпросмотр серверного файла заявки (по requestId + fileId, через download-proxy). */
export function FilePreviewModal({
  open, onClose, requestId, fileId, fileName, mimeType,
}: {
  open: boolean; onClose: () => void; requestId: string; fileId: string; fileName: string; mimeType?: string | null;
}) {
  const { message } = App.useApp();
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setBuffer(null); return; }
    let cancelled = false;
    setLoading(true);
    api.getArrayBuffer(`/requests/${requestId}/file/${fileId}`)
      .then((ab) => { if (!cancelled) setBuffer(ab); })
      .catch((e) => { if (!cancelled) message.error((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, requestId, fileId, message]);

  return (
    <Modal title={fileName} open={open} onCancel={onClose} footer={null} width={modalWidth(900)} style={{ top: 20 }} destroyOnClose>
      {loading || !buffer
        ? <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
        : <PreviewBody buffer={buffer} fileName={fileName} mimeType={mimeType} />}
    </Modal>
  );
}

/** Предпросмотр локального (ещё не загруженного) файла. */
export function LocalFilePreviewModal({
  open, onClose, file, fileName,
}: {
  open: boolean; onClose: () => void; file: File | null; fileName: string;
}) {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    if (!open || !file) { setBuffer(null); return; }
    let cancelled = false;
    file.arrayBuffer().then((ab) => { if (!cancelled) setBuffer(ab); });
    return () => { cancelled = true; };
  }, [open, file]);

  return (
    <Modal title={fileName} open={open} onCancel={onClose} footer={null} width={modalWidth(900)} style={{ top: 20 }} destroyOnClose>
      {!buffer
        ? <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
        : <PreviewBody buffer={buffer} fileName={fileName} mimeType={file?.type} />}
    </Modal>
  );
}
