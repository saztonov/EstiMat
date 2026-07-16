import { Tabs } from 'antd';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { AiJobsPanel } from './AiJobsPanel';
import { LlmServerPanel } from './LlmServerPanel';
import { PromptsPanel } from './PromptsPanel';

const tabs = [
  { key: 'ai-jobs', label: 'Задания ИИ', children: <AiJobsPanel /> },
  { key: 'llm-server', label: 'Сервер моделей', children: <LlmServerPanel /> },
  { key: 'prompts', label: 'Промпты', children: <PromptsPanel /> },
];

// Вкладка «Нейросети»: задания ИИ, сервер моделей и редактор промптов.
export function NeuralPanel() {
  const [activeTab, setActiveTab] = usePersistedTab('estimat:administration-neural-tab', 'ai-jobs');

  return (
    <Tabs
      activeKey={activeTab}
      onChange={setActiveTab}
      items={tabs}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    />
  );
}
