import { Card, Tabs } from 'antd';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { UsersPanel } from './UsersPanel';
import { SettingsPanel } from './SettingsPanel';
import { NeuralPanel } from './NeuralPanel';
import { PayhubPanel } from './PayhubPanel';

const TOP_TAB_KEY = 'estimat:administration-tab';
const NEURAL_TAB_KEY = 'estimat:administration-neural-tab';

// Однократная миграция: прежние верхнеуровневые вкладки «Задания ИИ» и «Сервер моделей» переехали
// внутрь вкладки «Нейросети». Без переноса сохранённый ключ не совпал бы ни с одной вкладкой, и
// пользователь увидел бы пустой экран.
try {
  const saved = localStorage.getItem(TOP_TAB_KEY);
  if (saved === 'ai-jobs' || saved === 'llm-server') {
    localStorage.setItem(NEURAL_TAB_KEY, saved);
    localStorage.setItem(TOP_TAB_KEY, 'neural');
  }
} catch {
  /* localStorage недоступен — миграция не нужна */
}

const tabs = [
  { key: 'users', label: 'Пользователи', children: <UsersPanel /> },
  { key: 'neural', label: 'Нейросети', children: <NeuralPanel /> },
  { key: 'payhub', label: 'Интеграция PayHub', children: <PayhubPanel /> },
  { key: 'settings', label: 'Настройки', children: <SettingsPanel /> },
];

export function AdministrationPage() {
  const [activeTab, setActiveTab] = usePersistedTab(TOP_TAB_KEY, 'users');

  return (
    <Card
      title="Администрирование"
      className="estimat-tabs-card"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 24px 24px' } }}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
    </Card>
  );
}
