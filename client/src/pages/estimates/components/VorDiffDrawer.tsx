import { Drawer, Spin, Empty, Tag, Alert } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import type { VorDiffResponse, VorItemDiff, VorMaterialChange } from '@estimat/shared';
import { ChangeList } from './ChangeList';

interface Props {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  vor: { id: string; name: string } | null;
}

const MAT_KIND: Record<VorMaterialChange['kind'], { label: string; color: string }> = {
  added: { label: 'Добавлен', color: 'green' },
  removed: { label: 'Удалён', color: 'red' },
  changed: { label: 'Изменён', color: 'gold' },
};

function ItemDiffCard({ item }: { item: VorItemDiff }) {
  return (
    <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {item.state === 'deleted' && <Tag color="red">Удалена из сметы</Tag>}
        {item.name || '(без наименования)'}
      </div>
      <ChangeList rows={item.fields} />
      {item.materials.map((m, i) => (
        <div key={i} style={{ fontSize: 12, marginTop: 4 }}>
          <Tag color={MAT_KIND[m.kind].color} style={{ marginRight: 4 }}>
            {MAT_KIND[m.kind].label}
          </Tag>
          {m.name}
          {m.fields && m.fields.length > 0 && (
            <div style={{ marginLeft: 12 }}>
              <ChangeList rows={m.fields} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Drawer «Отличия от ВОР»: точный diff «было в ВОР → стало сейчас» по построчному снимку.
// По умолчанию показываем только изменённые/удалённые строки (onlyChanged).
export function VorDiffDrawer({ open, onClose, estimateId, vor }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['estimate-vor-diff', estimateId, vor?.id],
    queryFn: () =>
      api
        .get<{ data: VorDiffResponse }>(`/estimates/${estimateId}/vors/${vor!.id}/diff?onlyChanged=true`)
        .then((r) => r.data),
    enabled: open && !!vor,
  });

  const items = data?.items ?? [];

  return (
    <Drawer
      title={vor ? `Отличия от ВОР: ${vor.name}` : 'Отличия от ВОР'}
      open={open}
      onClose={onClose}
      width={480}
    >
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : !data?.manifestOk ? (
        <Alert
          type="warning"
          showIcon
          message="Снимок ВОР недоступен"
          description="Подробные отличия показать нельзя, но статус изменений в списке ВОР остаётся достоверным."
        />
      ) : items.length === 0 ? (
        <Empty description="Изменений нет — ВОР актуален" />
      ) : (
        items.map((it) => <ItemDiffCard key={it.itemId} item={it} />)
      )}
    </Drawer>
  );
}
