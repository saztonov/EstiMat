import { Card, Tabs } from 'antd';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { VersionHistoryButton } from '../../components/VersionHistoryButton';
import { RequestsListTab } from './RequestsListTab';
import { RpRegistryTab } from './RpRegistryTab';
import { SU10MaterialsTab } from './SU10MaterialsTab';
import { PurchasesRegistryTab } from './PurchasesRegistryTab';

/**
 * Раздел «Заявки» — пульт снабжения: реестры заявок, материалов, заказов и РП.
 * Открыт только внутренним ролям (RoleRoute в App.tsx); свои заявки подрядчик видит
 * в разделе «Подрядчики».
 */
export function RequestsPage() {
  const [tab, setTab] = usePersistedTab('estimat:requests-tab', 'requests');

  return (
    <Card
      title="Заявки"
      extra={<VersionHistoryButton />}
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
          // Ключ 'lots' исторический и НЕ меняется: он сохранён в localStorage (usePersistedTab),
          // и при смене activeKey не совпал бы ни с одним items[].key — раздел открылся бы пустым.
          { key: 'lots', label: 'Заказы', children: <PurchasesRegistryTab /> },
          { key: 'rp-registry', label: 'Реестр РП', children: <RpRegistryTab /> },
        ]}
      />
    </Card>
  );
}
