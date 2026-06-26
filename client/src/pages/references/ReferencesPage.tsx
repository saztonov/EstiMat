import { Card, Tabs } from 'antd';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { ProjectsPanel } from './ProjectsPanel';
import { OrganizationsPanel } from './OrganizationsPanel';
import { MaterialsPanel } from './MaterialsPanel';
import { RatesPanel } from './RatesPanel';
import { UnitsPanel } from './UnitsPanel';
import { RoomTypesPanel } from './RoomTypesPanel';
// Временно скрыто (см. память проекта, вернуться ~2026-07-03)
// import { CatalogComparePanel } from './CatalogComparePanel';

const tabs = [
  { key: 'projects', label: 'Проекты', children: <ProjectsPanel /> },
  { key: 'organizations', label: 'Организации', children: <OrganizationsPanel /> },
  { key: 'materials', label: 'Материалы', children: <MaterialsPanel /> },
  { key: 'rates', label: 'Работы', children: <RatesPanel /> },
  { key: 'units', label: 'Единицы измерения', children: <UnitsPanel /> },
  { key: 'room-types', label: 'Типы помещений', children: <RoomTypesPanel /> },
  // Временно скрыто (см. память проекта, вернуться ~2026-07-03)
  // { key: 'catalog-compare', label: 'Сравнение справочников', children: <CatalogComparePanel /> },
];

export function ReferencesPage() {
  const [activeTab, setActiveTab] = usePersistedTab('estimat:references-tab', 'projects');

  return (
    <Card
      title="Справочники"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 24px 24px' } }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabs}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      />
    </Card>
  );
}
