import { Card, Tabs } from 'antd';
import { UsersPanel } from './UsersPanel';

const tabs = [
  { key: 'users', label: 'Пользователи', children: <UsersPanel /> },
];

export function AdministrationPage() {
  return (
    <Card title="Администрирование">
      <Tabs items={tabs} />
    </Card>
  );
}
