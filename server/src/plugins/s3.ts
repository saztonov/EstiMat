import fp from 'fastify-plugin';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { LRUCache } from 'lru-cache';
import type { Readable } from 'stream';
import { config } from '../config.js';

// Хранилище файлов в S3-совместимом объектном хранилище (Cloud.ru) — корп. стандарт §15.
// Backend-proxied upload: бэкенд кладёт объект, а на чтение выдаёт presigned GET-URL.
// Объекты приватные; ключ генерируется бэкендом. Паттерн S3Client + presign + LRU-кэш
// повторяет rd-portal.ts (presign для R2).

const PRESIGN_TTL_SEC = 3600; // подпись на 1 час
const URL_CACHE_MS = 50 * 60_000; // кэш короче подписи, чтобы не отдавать почти истёкшие

export interface Storage {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  // Потоковая загрузка (managed multipart) — не буферизует крупные файлы в память.
  putObjectStream(key: string, body: Readable, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  presignGet(key: string, ttlSec?: number): Promise<string>;
  // Чтение объекта стримом — для отдачи через API-прокси (браузер не ходит в S3 напрямую).
  getObject(key: string): Promise<{ body: Readable; contentType?: string; contentLength?: number }>;
}

function buildStorage(): Storage {
  const { endpoint, region, accessKey, secretKey, bucket } = config.s3;

  const s3 = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });

  const urlCache = new LRUCache<string, string>({ max: 1000, ttl: URL_CACHE_MS });

  return {
    async putObject(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async putObjectStream(key, body, contentType) {
      // Managed multipart: части грузятся по мере поступления, файл целиком в память не берётся.
      const upload = new Upload({
        client: s3,
        params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
        partSize: 5 * 1024 * 1024,
        queueSize: 3,
      });
      await upload.done();
    },

    async deleteObject(key) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        urlCache.delete(key);
      } catch {
        // §15: повторное удаление отсутствующего объекта считается успешным.
      }
    },

    async presignGet(key, ttlSec = PRESIGN_TTL_SEC) {
      const cached = urlCache.get(key);
      if (cached) return cached;
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: ttlSec },
      );
      urlCache.set(key, url);
      return url;
    },

    async getObject(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return {
        body: res.Body as Readable,
        contentType: res.ContentType,
        contentLength: res.ContentLength,
      };
    },
  };
}

export default fp(async (fastify) => {
  if (!config.s3.enabled) {
    fastify.decorate('storage', null);
    fastify.log.info('S3 storage: not configured (S3_* env vars empty) — uploads fall back to local disk');
    return;
  }
  fastify.decorate('storage', buildStorage());
  fastify.log.info('S3 storage: configured');
});
