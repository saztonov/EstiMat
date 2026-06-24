/**
 * Контроль доступа к сметам/объектам для ИИ-чата. Ассистент агрегирует данные
 * (в т.ч. чужих смет), поэтому доступ формализован отдельным слоем, а не «всем
 * авторизованным».
 *
 * Правило: admin и engineer — все объекты; иначе объект, в котором пользователь
 * состоит (project_members).
 */
import type { Queryable, ChatUser } from './types.js';

export class ChatAccessError extends Error {
  constructor(
    message: string,
    public readonly status: number = 403,
  ) {
    super(message);
    this.name = 'ChatAccessError';
  }
}

export function isAdmin(user: ChatUser): boolean {
  return user.role === 'admin';
}

/** Полный доступ ко всем сметам/чатам: админ и инженер-сметчик. */
export function hasFullEstimateAccess(user: ChatUser): boolean {
  return user.role === 'admin' || user.role === 'engineer';
}

/** Проверить доступ к смете и вернуть её projectId. Бросает ChatAccessError. */
export async function assertEstimateAccess(
  db: Queryable,
  estimateId: string,
  user: ChatUser,
): Promise<{ projectId: string }> {
  const { rows } = await db.query(
    `SELECT project_id FROM estimates WHERE id = $1`,
    [estimateId],
  );
  if (rows.length === 0) throw new ChatAccessError('Смета не найдена', 404);

  const { project_id: projectId } = rows[0];
  if (hasFullEstimateAccess(user)) return { projectId };

  const member = await db.query(
    `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [projectId, user.id],
  );
  if (member.rows.length > 0) return { projectId };

  throw new ChatAccessError('Нет доступа к смете');
}

/**
 * SQL-фрагмент фильтра доступных объектов для поиска по чужим сметам.
 * Возвращает условие и список значений-параметров, начиная с индекса `startIdx`.
 * Алиас таблицы projects — `p`.
 */
export function accessibleProjectsClause(
  user: ChatUser,
  startIdx: number,
): { clause: string; values: unknown[] } {
  if (hasFullEstimateAccess(user)) return { clause: 'TRUE', values: [] };
  // $startIdx — userId
  return {
    clause: `p.id IN (SELECT project_id FROM project_members WHERE user_id = $${startIdx})`,
    values: [user.id],
  };
}
