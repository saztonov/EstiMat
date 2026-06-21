import { Drawer, Timeline, Empty, Spin, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { AuditLogEntry } from '@estimat/shared';
import { getEstimateHistory } from '../../../services/estimateHistory';

interface Props {
  estimateId: string;
  /** Если задан — история конкретной строки (работы/материала). */
  entityId?: string;
  title?: string;
  open: boolean;
  onClose: () => void;
}

const ACTION_LABEL: Record<string, string> = {
  create: 'добавил(а)',
  update: 'изменил(а)',
  delete: 'удалил(а)',
  reassign: 'перенёс(ла)',
  confirm: 'согласовал(а)',
  ai_apply: 'применил(а) ИИ',
};

const ENTITY_LABEL: Record<string, string> = {
  estimate: 'смету',
  estimate_item: 'работу',
  estimate_material: 'материал',
  estimate_contractor: 'подрядчика',
};

const ACTION_COLOR: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  reassign: 'gold',
  confirm: 'cyan',
  ai_apply: 'purple',
};

const FIELD_LABEL: Record<string, string> = {
  description: 'наименование',
  quantity: 'кол-во',
  unit: 'ед.',
  unit_price: 'цена',
  needs_review: 'согласование',
  cost_type_id: 'вид работ',
  status: 'статус',
};

function entityName(e: AuditLogEntry): string | null {
  const after = (e.changes?.after ?? null) as Record<string, unknown> | null;
  const before = (e.changes?.before ?? null) as Record<string, unknown> | null;
  const d = (after?.description ?? before?.description) as string | undefined;
  return d ?? null;
}

function describe(e: AuditLogEntry): string {
  const who = e.userName ?? 'Система';
  const act = ACTION_LABEL[e.action] ?? e.action;
  if (e.action === 'ai_apply') {
    const w = Number(e.changes?.works ?? 0);
    const m = Number(e.changes?.materials ?? 0);
    return `${who} применил(а) ИИ: работ ${w}, материалов ${m}`;
  }
  const ent = ENTITY_LABEL[e.entityType] ?? e.entityType;
  const name = entityName(e);
  return `${who} ${act} ${ent}${name ? `: ${name}` : ''}`;
}

// Изменённые поля (для update): «поле: старое → новое».
function changedRows(e: AuditLogEntry): { field: string; before: unknown; after: unknown }[] {
  const fields = e.changes?.changedFields;
  if (!Array.isArray(fields) || e.action !== 'update') return [];
  const before = (e.changes?.before ?? {}) as Record<string, unknown>;
  const after = (e.changes?.after ?? {}) as Record<string, unknown>;
  return fields.map((f) => ({ field: FIELD_LABEL[f] ?? f, before: before[f], after: after[f] }));
}

export function EstimateHistoryDrawer({ estimateId, entityId, title, open, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['estimate-history', estimateId, entityId ?? null],
    queryFn: () => getEstimateHistory(estimateId, { entityId }),
    enabled: open,
  });
  const items = data?.data ?? [];

  return (
    <Drawer title={title ?? 'История изменений'} open={open} onClose={onClose} width={460} destroyOnClose>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет записей" />
      ) : (
        <Timeline
          items={items.map((e) => ({
            color: ACTION_COLOR[e.action] ?? 'gray',
            children: (
              <div>
                <div style={{ fontSize: 13 }}>
                  {describe(e)} <Tag color={ACTION_COLOR[e.action]}>{ACTION_LABEL[e.action] ?? e.action}</Tag>
                </div>
                {changedRows(e).map((c, idx) => (
                  <Typography.Text key={idx} type="secondary" style={{ fontSize: 12, display: 'block' }}>
                    {c.field}: {String(c.before ?? '—')} → {String(c.after ?? '—')}
                  </Typography.Text>
                ))}
                <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                  {new Date(e.createdAt).toLocaleString('ru-RU')}
                </Typography.Text>
              </div>
            ),
          }))}
        />
      )}
    </Drawer>
  );
}
