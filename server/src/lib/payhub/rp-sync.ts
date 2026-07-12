/**
 * Доменная логика РП↔PayHub для EstiMat: резолв конфигурации (маппинг объекта, отправитель),
 * идемпотентное создание письма (lookup→create→adopt по external_ref) и догрузка вложений.
 *
 * Письмо создаётся СИНХРОННО в действии «Отправить РП» (для честного статуса rp_sent + рег.номер),
 * вложения досылаются отдельно (rp_letter.sync через outbox), поэтому недоступность PayHub на
 * этапе вложений не откатывает отправку.
 */
import type { Pool, PoolClient } from 'pg';
import type { Readable } from 'node:stream';
import type { Storage } from '../../plugins/s3.js';
import { PayHubApiError, PayHubWaitingConfigError } from './errors.js';
import type { PayHubClient } from './client.js';

type Db = Pool | PoolClient;

export const rpExternalRef = (requestId: string): string => `estimat:rp:${requestId}`;
export const rpAttachmentMark = (fileId: string): string => `estimat:att:${fileId}`;

export interface RpSender {
  contractorId: number;
  name: string | null;
  inn: string | null;
}

/** Настройка «Отправитель РП» из app_settings. null — не настроено. */
export async function getRpSender(db: Db): Promise<RpSender | null> {
  const { rows } = await db.query(`SELECT value FROM app_settings WHERE key = 'payhub_rp_sender'`);
  const v = rows[0]?.value as { contractorId?: number | string; name?: string; inn?: string } | undefined;
  if (!v || v.contractorId == null) return null;
  const contractorId = Number(v.contractorId);
  if (!Number.isInteger(contractorId) || contractorId <= 0) return null;
  return { contractorId, name: v.name ?? null, inn: v.inn ?? null };
}

export interface LetterConfig {
  projectId: number;
  recipientId: number;
  senderId: number;
}

/** Резолв конфигурации отправки. Бросает PayHubWaitingConfigError при нехватке настроек. */
export async function resolveLetterConfig(db: Db, requestId: string): Promise<LetterConfig> {
  const { rows } = await db.query(
    `SELECT p.payhub_project_id, p.payhub_contractor_id
       FROM material_requests mr
       LEFT JOIN projects p ON p.id = mr.project_id
      WHERE mr.id = $1`,
    [requestId],
  );
  const r = rows[0];
  if (!r) throw new PayHubWaitingConfigError('Заявка не найдена');
  if (r.payhub_project_id == null) {
    throw new PayHubWaitingConfigError('Объект не сопоставлен с проектом PayHub (Администрирование → PayHub)');
  }
  if (r.payhub_contractor_id == null) {
    throw new PayHubWaitingConfigError('Объект не сопоставлен с получателем PayHub (Администрирование → PayHub)');
  }
  const sender = await getRpSender(db);
  if (!sender) {
    throw new PayHubWaitingConfigError('Не настроен «Отправитель РП» (Администрирование → PayHub)');
  }
  return {
    projectId: Number(r.payhub_project_id),
    recipientId: Number(r.payhub_contractor_id),
    senderId: sender.contractorId,
  };
}

/** content письма: "<сумма> ₽, <поставщик>, <описание>". */
export function buildLetterContent(input: {
  amount: number | string;
  supplierName: string;
  description?: string | null;
}): string {
  const money = Number(input.amount).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return [`${money} ₽`, input.supplierName, input.description || undefined].filter(Boolean).join(', ');
}

function validateShareUrl(url: string | undefined): string | null {
  if (!url || url.length > 2048) return null;
  try {
    const p = new URL(url);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null;
  } catch {
    return null;
  }
}

export interface EnsureLetterInput {
  externalRef: string;
  projectId: number;
  senderId: number;
  recipientId: number;
  letterDate: string;
  subject: string;
  content: string;
  responsibleName?: string | null;
  existingLetterId?: string | null;
}

export interface EnsuredLetter {
  letterId: string;
  regNumber: string | null;
  url: string | null;
}

/** Идемпотентно находит (lookup/adopt) либо создаёт письмо PayHub. */
export async function ensureRpLetter(client: PayHubClient, input: EnsureLetterInput): Promise<EnsuredLetter> {
  if (input.existingLetterId) {
    const letter = await client.getLetter(input.existingLetterId);
    return { letterId: letter.id, regNumber: letter.reg_number ?? null, url: null };
  }
  const found = await client.lookupByRef(input.externalRef);
  if (found) {
    return { letterId: found.letter.id, regNumber: found.letter.reg_number ?? null, url: validateShareUrl(found.share?.share_url) };
  }
  try {
    const created = await client.createLetter({
      project_id: input.projectId,
      direction: 'outgoing',
      letter_date: input.letterDate,
      subject: input.subject,
      content: input.content,
      responsible_person_name: input.responsibleName ?? undefined,
      sender_type: 'contractor',
      sender_contractor_id: input.senderId,
      recipient_type: 'contractor',
      recipient_contractor_id: input.recipientId,
      external_ref: input.externalRef,
      ensure_share: true,
    });
    return { letterId: created.letter.id, regNumber: created.letter.reg_number ?? null, url: validateShareUrl(created.share?.share_url) };
  } catch (e) {
    // Гонка/повтор: письмо с этим external_ref уже создано — усыновляем.
    if (e instanceof PayHubApiError && e.httpStatus === 409) {
      const existing = await client.lookupByRef(input.externalRef);
      if (existing) {
        return { letterId: existing.letter.id, regNumber: existing.letter.reg_number ?? null, url: validateShareUrl(existing.share?.share_url) };
      }
    }
    throw e;
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

/**
 * Догрузка зафиксированного набора вложений письма (rp_letter_attachments) в PayHub.
 * Идемпотентно: пропускает уже привязанные (payhub_attachment_id) и дедуплицирует по метке
 * estimat:att:<fileId> в description. Бросает ошибку, если хоть один файл не ушёл.
 */
export async function syncRpLetterAttachments(
  db: Db,
  storage: Storage,
  client: PayHubClient,
  rpLetter: { id: string; payhubLetterId: string },
): Promise<void> {
  const { rows: atts } = await db.query(
    `SELECT rla.id AS link_id, rla.file_id, f.file_key, f.file_name, f.mime_type
       FROM rp_letter_attachments rla
       JOIN material_request_files f ON f.id = rla.file_id
      WHERE rla.rp_letter_id = $1 AND rla.payhub_attachment_id IS NULL`,
    [rpLetter.id],
  );
  if (atts.length === 0) return;

  const existing = await client.listAttachments(rpLetter.payhubLetterId);
  const failures: string[] = [];
  for (const a of atts) {
    const mark = rpAttachmentMark(a.file_id);
    const dup = existing.find((e) => e.description === mark);
    if (dup) {
      await db.query(`UPDATE rp_letter_attachments SET payhub_attachment_id = $2 WHERE id = $1`, [a.link_id, dup.id]);
      continue;
    }
    try {
      const obj = await storage.getObject(a.file_key);
      const bytes = await streamToBuffer(obj.body);
      const up = await client.uploadAttachment(rpLetter.payhubLetterId, {
        name: a.file_name,
        bytes,
        mime_type: a.mime_type ?? undefined,
        description: mark,
      });
      await db.query(`UPDATE rp_letter_attachments SET payhub_attachment_id = $2 WHERE id = $1`, [a.link_id, up.id]);
    } catch {
      failures.push(a.file_name);
    }
  }
  if (failures.length > 0) throw new Error(`Не загружены вложения: ${failures.join(', ')}`);
}
