import { Card, Tabs } from 'antd';
import { useAuthStore } from '../../store/authStore';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { RequestsListTab } from './RequestsListTab';
import { RpRegistryTab } from './RpRegistryTab';
import { SU10MaterialsTab } from './SU10MaterialsTab';
import { SupplierLotsTab } from './SupplierLotsTab';

/**
 * Раздел «Заявки». Инженер/внутренние роли — вкладки «Заявки» и «Реестр РП».
 * Подрядчик — список только своих заявок (скоуп на сервере), без вкладок.
 */
export function RequestsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isSupply = role === 'engineer' || role === 'admin' || role === 'manager';
  const [tab, setTab] = usePersistedTab('estimat:requests-tab', 'requests');

  return (
    <Card
      title="Заявки"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ header: { paddingLeft: 48 }, body: { flex: 1, minHeight: 0, overflow: 'auto' } }}
    >
      {isSupply ? (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'requests', label: 'Заявки', children: <RequestsListTab /> },
            { key: 'materials', label: 'Материалы', children: <SU10MaterialsTab /> },
            { key: 'lots', label: 'Закупочные лоты', children: <SupplierLotsTab /> },
            { key: 'rp-registry', label: 'Реестр РП', children: <RpRegistryTab /> },
          ]}
        />
      ) : (
        <RequestsListTab />
      )}
    </Card>
  );
}
