import { Modal, Space, Tag } from 'antd';
import type { AiTaskItem } from '@estimat/shared';
import { TASK_KIND, TASK_STATUS } from './aiTaskDicts';
import { AiTaskDetailContent } from './AiTaskDetailContent';

/**
 * Карточка задачи ИИ. Тонкая обёртка над контентом — канон RequestDetailModal.
 *
 * destroyOnHidden обязателен: журнал одной задачи — это сотни килобайт текста, и держать их в
 * памяти после закрытия незачем (destroyOnClose в antd 5.29 объявлен устаревшим).
 */
export function AiTaskDetailModal({ task, onClose }: { task: AiTaskItem | null; onClose: () => void }) {
  return (
    <Modal
      open={!!task}
      onCancel={onClose}
      footer={null}
      width="80vw"
      style={{ top: 20 }}
      styles={{
        body: {
          height: 'calc(90vh - 56px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: 12,
        },
      }}
      destroyOnHidden
      title={
        task && (
          <Space size={6} wrap>
            <Tag color={TASK_KIND[task.kind].color}>{TASK_KIND[task.kind].full}</Tag>
            <span>{task.title}</span>
            <Tag color={TASK_STATUS[task.status]?.color}>
              {TASK_STATUS[task.status]?.label ?? task.status}
            </Tag>
          </Space>
        )
      }
    >
      {task && <AiTaskDetailContent task={task} />}
    </Modal>
  );
}
