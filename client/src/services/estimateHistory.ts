import { api } from './api';
import type { AuditLogEntry } from '@estimat/shared';

// Лента истории сметы (или истории конкретной строки при entityId).
export function getEstimateHistory(
  estimateId: string,
  opts?: { entityId?: string; limit?: number; offset?: number },
) {
  const p = new URLSearchParams();
  if (opts?.entityId) p.set('entityId', opts.entityId);
  if (opts?.limit) p.set('limit', String(opts.limit));
  if (opts?.offset) p.set('offset', String(opts.offset));
  const qs = p.toString();
  return api.get<{ data: AuditLogEntry[] }>(`/estimates/${estimateId}/history${qs ? `?${qs}` : ''}`);
}
