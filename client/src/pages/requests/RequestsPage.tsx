import { Card, Tabs } from 'antd';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { RequestsListTab } from './RequestsListTab';
import { RpRegistryTab } from './RpRegistryTab';
import { SU10MaterialsTab } from './SU10MaterialsTab';
import { PurchasesRegistryTab } from './PurchasesRegistryTab';

/**
 * Раздел «Заявки» — пульт снабжения: реестры заявок, материалов, закупок и РП.
 * Открыт только внутренним ролям (RoleRoute в App.tsx); свои заявки подрядчик видит
 * в разделе «Подрядчики».
 */
export function RequestsPage() {
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
    </Card>
  );
}
