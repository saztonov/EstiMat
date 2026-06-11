import { Card, Tabs } from 'antd';
import { UsersPanel } from './UsersPanel';
import { SettingsPanel } from './SettingsPanel';
import { CatalogComparePanel } from './CatalogComparePanel';

const tabs = [
  { key: 'users', label: 'Пользователи', children: <UsersPanel /> },
  { key: 'settings', label: 'Настройки', children: <SettingsPanel /> },
  { key: 'catalog-compare', label: 'Сравнение справочников', children: <CatalogComparePanel /> },
];

export function AdministrationPage() {
  return (
    <Card
      title="Администрирование"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 24px 24px' } }}
    >
      <Tabs items={tabs} />
    </Card>
  );
}
