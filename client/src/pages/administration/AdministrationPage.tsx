import { Card, Tabs } from 'antd';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { UsersPanel } from './UsersPanel';
import { SettingsPanel } from './SettingsPanel';
import { AiJobsPanel } from './AiJobsPanel';

const tabs = [
  { key: 'users', label: 'Пользователи', children: <UsersPanel /> },
  { key: 'ai-jobs', label: 'Задания ИИ', children: <AiJobsPanel /> },
  { key: 'settings', label: 'Настройки', children: <SettingsPanel /> },
];

export function AdministrationPage() {
  const [activeTab, setActiveTab] = usePersistedTab('estimat:administration-tab', 'users');

  return (
    <Card
      title="Администрирование"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 24px 24px' } }}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
    </Card>
  );
}
