import { Card, Tabs } from 'antd';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { ProjectsPanel } from './ProjectsPanel';
import { OrganizationsPanel } from './OrganizationsPanel';
import { MaterialsPanel } from './MaterialsPanel';
import { RatesPanel } from './RatesPanel';
import { UnitsPanel } from './UnitsPanel';

const tabs = [
  { key: 'projects', label: 'Проекты', children: <ProjectsPanel /> },
  { key: 'organizations', label: 'Организации', children: <OrganizationsPanel /> },
  { key: 'materials', label: 'Материалы', children: <MaterialsPanel /> },
  { key: 'rates', label: 'Расценки', children: <RatesPanel /> },
  { key: 'units', label: 'Единицы измерения', children: <UnitsPanel /> },
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
