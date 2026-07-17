import { Tabs } from 'antd';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { AiTasksPanel } from './aiTasks/AiTasksPanel';
import { LlmServerPanel } from './LlmServerPanel';
import { PromptsPanel } from './PromptsPanel';

const tabs = [
  // Ключ 'ai-jobs' исторический: он лежит в localStorage у всех, и переименование сбросило бы
  // выбранную вкладку. Содержимое шире названия — задачи всех контуров ИИ, не только задания РД.
  { key: 'ai-jobs', label: 'Задания ИИ', children: <AiTasksPanel /> },
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
