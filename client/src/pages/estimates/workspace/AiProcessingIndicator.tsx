import { Progress, Spin, Tooltip, Typography } from 'antd';
import {
  FileSearchOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  StopOutlined,
} from '@ant-design/icons';
import type { AiJobStatus } from '@estimat/shared';
import { useAiExtractJob } from '../../../hooks/useAiExtractJob';
import { useAiChatStatus } from '../../../hooks/useAiChatStatus';

// Стадийный прогресс РД: backend реального процента не отдаёт (ai_jobs хранит только статус),
// поэтому проценты — ориентир по стадии жизненного цикла, не реальный progress.
const RD_STAGE: Record<AiJobStatus, { pct: number; text: string; kind: 'active' | 'done' | 'error' | 'stopped' }> = {
  pending: { pct: 10, text: 'в очереди', kind: 'active' },
  running: { pct: 50, text: 'обработка', kind: 'active' },
  ready: { pct: 90, text: 'готово', kind: 'active' },
  applied: { pct: 100, text: 'в смете', kind: 'done' },
  failed: { pct: 100, text: 'ошибка', kind: 'error' },
  cancelled: { pct: 100, text: 'остановлено', kind: 'stopped' },
};

// Постоянный индикатор статуса LLM-обработки в верхней строке workspace.
// Живёт в тулбаре (он всегда смонтирован, вне Splitter), поэтому статус «Обработка РД» и «Чат»
// виден при скрытых справочниках, свёрнутой ИИ-панели и на любой вкладке.
export function AiProcessingIndicator({ estimateId }: { estimateId: string }) {
  const { job } = useAiExtractJob(estimateId);
  const { busy, stepCount } = useAiChatStatus(estimateId);

  const rd = job ? RD_STAGE[job.status] : null;
  if (!rd && !busy) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
      {rd && (
        <Tooltip title={job?.status === 'failed' ? (job.error ?? 'Ошибка извлечения') : `Обработка РД: ${rd.text}`}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <FileSearchOutlined style={{ color: '#1677ff' }} />
            <Typography.Text style={{ fontSize: 12.5 }}>РД: {rd.text}</Typography.Text>
            {rd.kind === 'active' && (
              <div style={{ width: 64 }}>
                <Progress percent={rd.pct} showInfo={false} size="small" status="active" />
              </div>
            )}
            {rd.kind === 'done' && <CheckCircleFilled style={{ color: '#52c41a' }} />}
            {rd.kind === 'error' && <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
            {rd.kind === 'stopped' && <StopOutlined style={{ color: '#faad14' }} />}
          </span>
        </Tooltip>
      )}

      {busy && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <Spin size="small" />
          <Typography.Text style={{ fontSize: 12.5 }}>
            Чат: думает…{stepCount ? ` (${stepCount})` : ''}
          </Typography.Text>
        </span>
      )}
    </div>
  );
}
