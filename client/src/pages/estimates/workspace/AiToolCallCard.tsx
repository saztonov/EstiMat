import { Spin } from 'antd';
import { CheckCircleTwoTone, CloseCircleTwoTone } from '@ant-design/icons';
import type { ChatStep, ChatStepKind } from '@estimat/shared';

const ICON: Record<ChatStepKind, string> = {
  search_works: '🔍',
  search_materials: '🔍',
  typical_materials: '📦',
  similar_works: '📋',
  similar_materials: '📋',
  estimate_context: '🧾',
  list_categories: '🗂️',
  estimate_quantity: '🧮',
  section_preview: '📑',
};

// Один шаг работы агента (вызов инструмента) — компактная строка хода.
export function AiToolCallCard({ step }: { step: ChatStep }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: step.status === 'error' ? 'var(--est-error-text)' : 'var(--est-text-secondary)',
        padding: '2px 0',
      }}
    >
      <span>{ICON[step.kind] ?? '•'}</span>
      <span style={{ flex: 1 }}>{step.label}</span>
      {step.status === 'running' && <Spin size="small" />}
      {step.status === 'ok' && <CheckCircleTwoTone twoToneColor="#52c41a" />}
      {step.status === 'error' && <CloseCircleTwoTone twoToneColor="#cf1322" />}
    </div>
  );
}
