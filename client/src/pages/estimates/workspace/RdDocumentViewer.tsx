import { useRef, useState } from 'react';
import { Drawer, Tabs, List, Button, Spin, Empty, Modal, Image, App } from 'antd';
import {
  FilePdfOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FileOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RdFile, RdFilesResponse, RdFileUrlResponse, RdMarkdownResponse } from '@estimat/shared';
import { api } from '../../../services/api';
import type { RdDocPayload } from './rdTreeMappers';

interface Props {
  doc: RdDocPayload | null;
  onClose: () => void;
}

type Preview = { kind: 'pdf' | 'image'; url: string; title: string } | null;

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function fileIcon(file: RdFile) {
  if (file.mimeType === 'application/pdf') return <FilePdfOutlined style={{ color: 'var(--est-error-text)' }} />;
  if (file.mimeType.startsWith('image/')) return <FileImageOutlined style={{ color: 'var(--est-primary)' }} />;
  if (file.fileType === 'result_md') return <FileMarkdownOutlined style={{ color: 'var(--est-success-text)' }} />;
  return <FileOutlined />;
}

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'Исходный PDF',
  result_md: 'Распознанный markdown',
  ocr_html: 'OCR (HTML)',
  crop: 'Кроп',
};

// Просмотр распознанного документа из портала РД: markdown, файлы, кропы.
export function RdDocumentViewer({ doc, onClose }: Props) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<Preview>(null);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  // Подписанные ссылки живут ~15 минут — кэшируем и перезапрашиваем по истечении.
  const urlCache = useRef(new Map<string, { url: string; expiresAt: number }>());

  const docId = doc?.id ?? null;

  const mdQuery = useQuery({
    queryKey: ['rd-md', docId],
    queryFn: () => api.get<RdMarkdownResponse>(`/rd/documents/${docId}/markdown`),
    enabled: !!docId,
    staleTime: 10 * 60_000,
  });

  const filesQuery = useQuery({
    queryKey: ['rd-files', docId],
    queryFn: () => api.get<RdFilesResponse>(`/rd/documents/${docId}/files`),
    enabled: !!docId,
    staleTime: 10 * 60_000,
  });

  async function getFileUrl(fileId: string): Promise<string> {
    const cached = urlCache.current.get(fileId);
    if (cached && cached.expiresAt - Date.now() > 30_000) return cached.url;
    const res = await api.get<RdFileUrlResponse>(`/rd/files/${fileId}/url`);
    urlCache.current.set(fileId, res);
    return res.url;
  }

  async function openFile(file: RdFile) {
    setLoadingFileId(file.id);
    try {
      const url = await getFileUrl(file.id);
      if (file.mimeType === 'application/pdf') {
        setPreview({ kind: 'pdf', url, title: file.fileName });
      } else if (file.mimeType.startsWith('image/')) {
        setPreview({ kind: 'image', url, title: file.fileName });
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось открыть файл');
    } finally {
      setLoadingFileId(null);
    }
  }

  const files = filesQuery.data?.data ?? [];
  const regularFiles = files.filter((f) => f.fileType !== 'crop');
  const crops = files.filter((f) => f.fileType === 'crop');

  // Кропы группируем по страницам (pageIndex 0-based).
  const cropsByPage = new Map<number, RdFile[]>();
  for (const c of crops) {
    const page = c.metadata?.pageIndex ?? -1;
    const list = cropsByPage.get(page) ?? [];
    list.push(c);
    cropsByPage.set(page, list);
  }
  const pages = [...cropsByPage.keys()].sort((a, b) => a - b);

  const mdContent = mdQuery.data?.content ?? null;

  const tabs = [
    {
      key: 'md',
      label: 'Документ',
      children: mdQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : mdContent ? (
        <div className="rd-markdown" style={{ overflow: 'auto', height: '100%', paddingRight: 8 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{mdContent}</ReactMarkdown>
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет распознанного содержимого" />
      ),
    },
    {
      key: 'files',
      label: `Файлы${regularFiles.length ? ` (${regularFiles.length})` : ''}`,
      children: filesQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : regularFiles.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Файлов нет" />
      ) : (
        <List
          size="small"
          style={{ overflow: 'auto', height: '100%' }}
          dataSource={regularFiles}
          renderItem={(file) => (
            <List.Item
              actions={[
                <Button
                  key="open"
                  size="small"
                  icon={<ExportOutlined />}
                  loading={loadingFileId === file.id}
                  onClick={() => openFile(file)}
                >
                  Открыть
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={fileIcon(file)}
                title={<span style={{ fontSize: 13 }}>{file.fileName}</span>}
                description={
                  <span style={{ fontSize: 12 }}>
                    {FILE_TYPE_LABELS[file.fileType] ?? file.fileType}
                    {file.fileSize ? ` · ${formatSize(file.fileSize)}` : ''}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      ),
    },
    {
      key: 'crops',
      label: `Кропы${crops.length ? ` (${crops.length})` : ''}`,
      children: filesQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : crops.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Кропов нет" />
      ) : (
        <div style={{ overflow: 'auto', height: '100%', paddingRight: 8 }}>
          {pages.map((page) => (
            <div key={page} style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--est-text-secondary)', margin: '4px 0 8px' }}>
                {page >= 0 ? `Страница ${page + 1}` : 'Без страницы'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(cropsByPage.get(page) ?? []).map((crop) => (
                  <Button
                    key={crop.id}
                    size="small"
                    icon={fileIcon(crop)}
                    loading={loadingFileId === crop.id}
                    onClick={() => openFile(crop)}
                    title={crop.fileName}
                  >
                    {crop.metadata?.blockType ? `${crop.metadata.blockType} · ` : ''}
                    {crop.fileName.length > 24 ? `${crop.fileName.slice(0, 24)}…` : crop.fileName}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <Drawer
      open={!!doc}
      onClose={onClose}
      width="72vw"
      destroyOnClose
      title={doc ? (doc.code && doc.code !== doc.name ? `[${doc.code}] ${doc.name}` : doc.name) : ''}
      styles={{ body: { display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingTop: 8 } }}
    >
      <Tabs items={tabs} size="small" />

      {/* PDF — во встроенном вьювере браузера */}
      <Modal
        open={preview?.kind === 'pdf'}
        onCancel={() => setPreview(null)}
        footer={null}
        width="80vw"
        title={preview?.title}
        destroyOnClose
        styles={{ body: { padding: 0 } }}
      >
        {preview?.kind === 'pdf' && (
          <iframe
            src={preview.url}
            title={preview.title}
            style={{ width: '100%', height: '75vh', border: 'none' }}
          />
        )}
      </Modal>

      {/* Картинки — стандартный превью antd с зумом */}
      {preview?.kind === 'image' && (
        <Image
          style={{ display: 'none' }}
          src={preview.url}
          preview={{
            visible: true,
            src: preview.url,
            onVisibleChange: (visible) => {
              if (!visible) setPreview(null);
            },
          }}
        />
      )}
    </Drawer>
  );
}
