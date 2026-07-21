import { useState } from 'react';
import { Upload, Select, Button, Space, Tooltip, Typography } from 'antd';
import { InboxOutlined, EyeOutlined, DeleteOutlined, CheckCircleFilled } from '@ant-design/icons';
import type { RcFile } from 'antd/es/upload';
import { useNativeDropZone } from '../../hooks/useNativeDropZone';
import { formatSize } from '../../lib/files';
import { LocalFilePreviewModal } from './FilePreview';

const { Dragger } = Upload;
const { Text } = Typography;

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp';

export interface UploadItem {
  uid: string;
  file: File;
  docType: string | null;
}

interface Props {
  value: UploadItem[];
  onChange: (items: UploadItem[]) => void;
  /** Опции типа документа: { value: code, label } */
  docTypeOptions: { value: string; label: string }[];
  /** Подсветить незаполненные типы (после попытки отправки). */
  showValidation?: boolean;
}

/**
 * Прикрепление файлов: drag-n-drop площадка (мультизагрузка), затем для каждого файла — тип
 * документа из справочника (список автоширины) и предпросмотр. Модель voпорядка billhub.
 */
export function FileUploadList({ value, onChange, docTypeOptions, showValidation }: Props) {
  const [preview, setPreview] = useState<{ file: File; name: string } | null>(null);

  const addFiles = (files: File[]) => {
    const items = files.map((f) => ({ uid: crypto.randomUUID(), file: f, docType: null }));
    onChange([...value, ...items]);
  };

  const { ref, isDragOver } = useNativeDropZone(addFiles);

  const setType = (uid: string, docType: string) =>
    onChange(value.map((it) => (it.uid === uid ? { ...it, docType } : it)));
  const remove = (uid: string) => onChange(value.filter((it) => it.uid !== uid));

  return (
    <div ref={ref}>
      <Dragger
        accept={ACCEPT}
        multiple
        showUploadList={false}
        beforeUpload={(file, batch) => {
          if (file === batch[0]) addFiles(batch as RcFile[] as File[]);
          return false;
        }}
        style={{
          marginBottom: value.length > 0 ? 12 : 0,
          borderColor: isDragOver ? 'var(--est-primary)' : undefined,
          background: isDragOver ? 'var(--est-primary-bg)' : undefined,
        }}
      >
        <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}><InboxOutlined /></p>
        <p className="ant-upload-text">Перетащите файлы или нажмите для выбора</p>
        <p className="ant-upload-hint" style={{ fontSize: 12 }}>pdf, doc(x), xls(x), jpg, png, tiff, bmp</p>
      </Dragger>

      {value.map((it) => (
        <div
          key={it.uid}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                   border: '1px solid var(--est-border)', borderRadius: 6, marginBottom: 8 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Tooltip title={it.file.name}>
              <Text ellipsis style={{ maxWidth: '100%', display: 'block' }}>{it.file.name}</Text>
            </Tooltip>
            <Text type="secondary" style={{ fontSize: 12 }}>{formatSize(it.file.size)}</Text>
          </div>
          <Select
            placeholder={<span>Тип документа <span style={{ color: 'var(--est-error)' }}>*</span></span>}
            size="small"
            style={{ width: 180, flexShrink: 0 }}
            status={showValidation && !it.docType ? 'error' : undefined}
            popupMatchSelectWidth={false}
            styles={{ popup: { root: { maxWidth: 320 } } }}
            options={docTypeOptions}
            value={it.docType ?? undefined}
            onChange={(v) => setType(it.uid, v)}
          />
          <CheckCircleFilled style={{ color: 'var(--est-success)', fontSize: 16, flexShrink: 0, visibility: it.docType ? 'visible' : 'hidden' }} />
          <Space size={4}>
            <Tooltip title="Просмотр">
              <Button size="small" icon={<EyeOutlined />} onClick={() => setPreview({ file: it.file, name: it.file.name })} />
            </Tooltip>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(it.uid)} />
          </Space>
        </div>
      ))}

      <LocalFilePreviewModal
        open={!!preview}
        onClose={() => setPreview(null)}
        file={preview?.file ?? null}
        fileName={preview?.name ?? ''}
      />
    </div>
  );
}
