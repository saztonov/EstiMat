import fp from 'fastify-plugin';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { LRUCache } from 'lru-cache';
import type { RdFile, RdTreeNode } from '@estimat/shared';
import { config } from '../config.js';

// Портал РД (RDLOCAL): чтение дерева распознанных документов из Supabase
// (PostgREST, только GET) и выдача файлов из Cloudflare R2 (presigned URL).
// Никаких записей во внешнюю БД — read-only по построению.

const PAGE_SIZE = 1000;
const PRESIGN_TTL_SEC = 900; // 15 минут — сама подпись
const TREE_CACHE_MS = 5 * 60_000;
const MD_CACHE_MS = 10 * 60_000;
const URL_CACHE_MS = 10 * 60_000; // короче подписи, чтобы не отдавать почти истёкшие

// Ошибка обращения к внешнему порталу — роуты переводят её в 502.
export class RdPortalError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'RdPortalError';
  }
}

interface RawTreeNode {
  id: string;
  parent_id: string | null;
  node_type: string;
  name: string;
  code: string | null;
  sort_order: number | null;
  pdf_status: string | null;
}

interface RawNodeFile {
  id: string;
  node_id?: string;
  file_type: string;
  r2_key: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
}

export interface RdPortal {
  getTree(): Promise<RdTreeNode[]>;
  getDocumentFiles(nodeId: string): Promise<RdFile[]>;
  getMarkdown(nodeId: string): Promise<string | null>;
  presignFile(fileId: string): Promise<{ url: string; expiresAt: number } | null>;
}

function buildPortal(log: { warn: (obj: unknown, msg: string) => void }): RdPortal {
  const { supabaseUrl, supabaseKey, r2 } = config.rd;

  const s3 = new S3Client({
    region: 'auto',
    endpoint: r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    forcePathStyle: true,
  });

  const treeCache = new LRUCache<string, RdTreeNode[]>({ max: 1, ttl: TREE_CACHE_MS });
  const mdCache = new LRUCache<string, string>({ max: 50, ttl: MD_CACHE_MS });
  const urlCache = new LRUCache<string, { url: string; expiresAt: number }>({
    max: 500,
    ttl: URL_CACHE_MS,
  });

  // GET {supabaseUrl}/rest/v1/{table}?{query} с постраничным обходом —
  // PostgREST по умолчанию ограничивает выдачу (max-rows), поэтому limit/offset.
  async function fetchAll<T>(table: string, query: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const url = `${supabaseUrl}/rest/v1/${table}?${query}&limit=${PAGE_SIZE}&offset=${offset}`;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        });
      } catch (err) {
        throw new RdPortalError(`Портал РД недоступен (${table})`, err);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new RdPortalError(`Портал РД: ${table} → HTTP ${res.status} ${body.slice(0, 200)}`);
      }
      const page = (await res.json()) as T[];
      out.push(...page);
      if (page.length < PAGE_SIZE) return out;
    }
  }

  const NODE_TYPE_MAP: Record<string, RdTreeNode['type']> = {
    project: 'project',
    stage: 'stage',
    section: 'section',
    document: 'document',
  };

  async function loadTree(): Promise<RdTreeNode[]> {
    const [mdFiles, rawNodes] = await Promise.all([
      // order=id — стабильная пагинация limit/offset (без order PostgREST
      // не гарантирует порядок, страницы могут пересекаться).
      fetchAll<{ node_id: string }>('node_files', 'select=node_id&file_type=eq.result_md&order=id.asc'),
      fetchAll<RawTreeNode>(
        'tree_nodes',
        'select=id,parent_id,node_type,name,code,sort_order,pdf_status&order=id.asc',
      ),
    ]);

    const recognized = new Set(mdFiles.map((f) => f.node_id));
    const byId = new Map(rawNodes.map((n) => [n.id, n]));

    // Оставляем только распознанные документы и цепочки их предков.
    const keep = new Set<string>();
    for (const node of rawNodes) {
      if (node.node_type !== 'document' || !recognized.has(node.id)) continue;
      for (let cur: RawTreeNode | undefined = node; cur; cur = byId.get(cur.parent_id ?? '')) {
        if (keep.has(cur.id)) break;
        keep.add(cur.id);
      }
    }

    const childrenOf = new Map<string | null, RawTreeNode[]>();
    for (const node of rawNodes) {
      if (!keep.has(node.id)) continue;
      const list = childrenOf.get(node.parent_id) ?? [];
      list.push(node);
      childrenOf.set(node.parent_id, list);
    }
    for (const list of childrenOf.values()) {
      list.sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, 'ru'),
      );
    }

    // Узлы client схлопываем (верхний уровень дерева — объект/project);
    // прочие неизвестные типы-предки оставляем как section, чтобы не рвать ветку.
    const build = (raw: RawTreeNode): RdTreeNode => {
      const kids = (childrenOf.get(raw.id) ?? []).map(build);
      const node: RdTreeNode = {
        id: raw.id,
        type: NODE_TYPE_MAP[raw.node_type] ?? 'section',
        name: raw.name,
        code: raw.code,
      };
      if (raw.node_type === 'document') node.pdfStatus = raw.pdf_status ?? 'unknown';
      if (kids.length) node.children = kids;
      return node;
    };

    const roots: RdTreeNode[] = [];
    const walkTop = (raw: RawTreeNode) => {
      if (raw.node_type === 'client') {
        for (const child of childrenOf.get(raw.id) ?? []) walkTop(child);
      } else {
        roots.push(build(raw));
      }
    };
    for (const raw of childrenOf.get(null) ?? []) walkTop(raw);
    return roots;
  }

  async function getNodeFiles(nodeId: string): Promise<RawNodeFile[]> {
    return fetchAll<RawNodeFile>(
      'node_files',
      `select=id,file_type,r2_key,file_name,file_size,mime_type,metadata&node_id=eq.${nodeId}&order=id.asc`,
    );
  }

  async function readObjectAsText(key: string): Promise<string> {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
      return (await res.Body?.transformToString('utf-8')) ?? '';
    } catch (err) {
      throw new RdPortalError(`Портал РД: не удалось прочитать файл из R2 (${key})`, err);
    }
  }

  return {
    async getTree() {
      const cached = treeCache.get('tree');
      if (cached) return cached;
      const tree = await loadTree();
      treeCache.set('tree', tree);
      return tree;
    },

    async getDocumentFiles(nodeId) {
      const files = await getNodeFiles(nodeId);
      return files
        .filter((f) => f.file_type !== 'crops_folder' && f.file_type !== 'qa_manifest')
        .map((f): RdFile => {
          const meta = f.metadata ?? {};
          return {
            id: f.id,
            fileType: f.file_type,
            fileName: f.file_name,
            fileSize: Number(f.file_size ?? 0),
            mimeType: f.mime_type ?? 'application/octet-stream',
            metadata: {
              blockId: typeof meta.block_id === 'string' ? meta.block_id : undefined,
              pageIndex: typeof meta.page_index === 'number' ? meta.page_index : undefined,
              blockType: typeof meta.block_type === 'string' ? meta.block_type : undefined,
            },
          };
        });
    },

    async getMarkdown(nodeId) {
      const cached = mdCache.get(nodeId);
      if (cached !== undefined) return cached;
      const files = await getNodeFiles(nodeId);
      const md = files.find((f) => f.file_type === 'result_md');
      if (!md) return null;
      const content = await readObjectAsText(md.r2_key);
      mdCache.set(nodeId, content);
      return content;
    },

    async presignFile(fileId) {
      const cached = urlCache.get(fileId);
      if (cached) return cached;
      const rows = await fetchAll<RawNodeFile>(
        'node_files',
        `select=id,file_type,r2_key,file_name,file_size,mime_type,metadata&id=eq.${fileId}`,
      );
      const file = rows[0];
      if (!file) return null;
      try {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: r2.bucket,
            Key: file.r2_key,
            ResponseContentDisposition: 'inline',
            ...(file.mime_type ? { ResponseContentType: file.mime_type } : {}),
          }),
          { expiresIn: PRESIGN_TTL_SEC },
        );
        const result = { url, expiresAt: Date.now() + PRESIGN_TTL_SEC * 1000 };
        urlCache.set(fileId, result);
        return result;
      } catch (err) {
        log.warn({ err, fileId }, 'RD portal: presign failed');
        throw new RdPortalError('Портал РД: не удалось подписать ссылку на файл', err);
      }
    },
  };
}

export default fp(async (fastify) => {
  if (!config.rd.enabled) {
    fastify.decorate('rdPortal', null);
    fastify.log.info('RD portal: not configured (RD_* env vars are empty)');
    return;
  }
  fastify.decorate('rdPortal', buildPortal(fastify.log));
  fastify.log.info('RD portal: configured');
});
