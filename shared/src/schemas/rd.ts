// Типы ответов /api/rd — рабочая документация из портала RDLOCAL (read-only).
// Zod-схемы не нужны: только GET-эндпоинты, тел запросов нет.

export type RdNodeType = 'project' | 'stage' | 'section' | 'document';

export interface RdTreeNode {
  id: string;
  type: RdNodeType;
  name: string;
  code: string | null;
  /** Только у документов: unknown | processing | done | error | ... */
  pdfStatus?: string;
  children?: RdTreeNode[];
}

export type RdFileType = 'pdf' | 'result_md' | 'crop' | 'ocr_html' | string;

export interface RdFileMetadata {
  blockId?: string;
  pageIndex?: number;
  blockType?: string;
}

export interface RdFile {
  id: string;
  fileType: RdFileType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  metadata?: RdFileMetadata;
}

export interface RdTreeResponse {
  configured: boolean;
  data: RdTreeNode[];
}

export interface RdFilesResponse {
  data: RdFile[];
}

export interface RdMarkdownResponse {
  content: string | null;
}

export interface RdFileUrlResponse {
  url: string;
  /** Unix-время (мс), после которого подписанная ссылка недействительна */
  expiresAt: number;
}
