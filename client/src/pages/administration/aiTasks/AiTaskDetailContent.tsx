import { useState } from 'react';
import { Tabs } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { AiTaskItem } from '@estimat/shared';
import { getAiTask } from '../../../services/aiTasks';
import { AiTaskSummary } from './AiTaskSummary';
import { AiTaskCallsLog } from './AiTaskCallsLog';

/**
 * Две вкладки: сводка и полный журнал общения с моделью.
 *
 * Задача приходит объектом строки, а не id: сводка рисуется мгновенно, без сетевого запроса —
 * всё её содержимое уже есть в списке. Журнал грузится только при открытии своей вкладки.
 */
export function AiTaskDetailContent({ task }: { task: AiTaskItem }) {
  const [tab, setTab] = useState('summary');

  const detail = useQuery({
    queryKey: ['ai-task', task.kind, task.id],
    queryFn: () => getAiTask(task.kind, task.id),
    enabled: tab === 'log',
    // Журнал завершённой задачи неизменен, а весит много: держать его в кэше после закрытия
    // карточки незачем — размонтирование компонента сам кэш не чистит.
    gcTime: 0,
    staleTime: 30_000,
    refetchInterval: task.status === 'running' ? 3000 : false,
  });

  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={[
        { key: 'summary', label: 'Сводка', children: <AiTaskSummary task={task} /> },
        {
          key: 'log',
          label: 'Полный лог',
          children: (
            <AiTaskCallsLog
              task={task}
              calls={detail.data?.data.calls ?? []}
              turns={detail.data?.data.turns ?? []}
              loading={detail.isLoading}
              error={detail.error as Error | null}
            />
          ),
        },
      ]}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    />
  );
}
