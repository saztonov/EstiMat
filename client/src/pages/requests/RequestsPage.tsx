import { Card, Tabs } from 'antd';
import { useAuthStore } from '../../store/authStore';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { RequestsListTab } from './RequestsListTab';
import { RpRegistryTab } from './RpRegistryTab';
import { SU10MaterialsTab } from './SU10MaterialsTab';
import { PurchasesRegistryTab } from './PurchasesRegistryTab';

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
      className="estimat-tabs-card"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{
        header: { paddingLeft: 48 },
        body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 12px 12px' },
      }}
    >
      {isSupply ? (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          items={[
            { key: 'requests', label: 'Заявки', children: <RequestsListTab /> },
            { key: 'materials', label: 'Материалы', children: <SU10MaterialsTab /> },
            { key: 'lots', label: 'Закупки', children: <PurchasesRegistryTab /> },
            { key: 'rp-registry', label: 'Реестр РП', children: <RpRegistryTab /> },
          ]}
        />
      ) : (
        <RequestsListTab />
      )}
    </Card>
  );
}
