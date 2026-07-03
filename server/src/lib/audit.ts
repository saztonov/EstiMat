/**
 * Запись журнала изменений (audit_log). Вызывается из роутов внутри той же транзакции,
 * что и мутация (атомарность истории с изменением). Realtime-NOTIFY — отдельно, после COMMIT.
 */
import { randomUUID } from 'node:crypto';
import type { AuditChanges } from '@estimat/shared';

// Минимальный структурный интерфейс БД — совместим и с pg.Pool/PoolClient, и с адаптерным
// Queryable из lib/extract (рекорд аудита вызывается из обоих).
export interface AuditDb {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}
type Queryable = AuditDb;

export interface AuditInput {
  estimateId: string | null;
  projectId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  userId: string | null;
  correlationId?: string | null;
  changes?: AuditChanges | Record<string, unknown> | null;
}

const COLS =
  'id, entity_type, entity_id, action, user_id, changes, estimate_id, project_id, correlation_id';

function rowValues(input: AuditInput): unknown[] {
  return [
    randomUUID(),
    input.entityType,
    input.entityId,
    input.action,
    input.userId,
    JSON.stringify(input.changes ?? {}),
    input.estimateId,
    input.projectId ?? null,
    input.correlationId ?? null,
  ];
}

// Одна запись. Возвращает id записи (для связи с realtime-событием через auditLogId).
export async function recordAudit(db: Queryable, input: AuditInput): Promise<string> {
  const values = rowValues(input);
  await db.query(
    `INSERT INTO audit_log (${COLS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    values,
  );
  return values[0] as string;
}

// Пакетная вставка (массовые операции: confirm-all, bulk-delete, ai-применение).
export async function recordAuditBatch(db: Queryable, inputs: AuditInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const perRow = 9;
  const values: unknown[] = [];
  const tuples = inputs.map((input, idx) => {
    const base = idx * perRow;
    values.push(...rowValues(input));
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
  });
  await db.query(`INSERT INTO audit_log (${COLS}) VALUES ${tuples.join(', ')}`, values);
}

// Снимок изменённых полей для журнала: before/after по затронутым колонкам.
export function diffChanges(
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>,
  fields: string[],
): { before: Record<string, unknown>; after: Record<string, unknown>; changedFields: string[] } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const f of fields) {
    before[f] = oldRow[f];
    after[f] = newRow[f];
  }
  return { before, after, changedFields: fields };
}
