import { useSearchParams } from 'react-router';
import { Card, Tabs } from 'antd';
import { ProjectsPanel } from './ProjectsPanel';
import { OrganizationsPanel } from './OrganizationsPanel';
import { MaterialsPanel } from './MaterialsPanel';
import { RatesPanel } from './RatesPanel';

const tabs = [
  { key: 'projects', label: 'Проекты', children: <ProjectsPanel /> },
  { key: 'organizations', label: 'Организации', children: <OrganizationsPanel /> },
  { key: 'materials', label: 'Материалы', children: <MaterialsPanel /> },
  { key: 'rates', label: 'Расценки', children: <RatesPanel /> },
];

export function ReferencesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'projects';

  return (
    <Card
      title="Справочники"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 24px 24px' } }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams({ tab: key })}
        items={tabs}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      />
    </Card>
  );
}
