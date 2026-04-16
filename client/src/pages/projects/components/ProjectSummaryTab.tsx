import { Spin, Card, Empty } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { SummaryEstimateBlock, type SummaryEstimate } from './SummaryEstimateBlock';
import { formatMoney } from '../../estimates/components/types';

interface SummaryData {
  project: Record<string, unknown>;
  estimates: SummaryEstimate[];
  grandTotal: number;
}

interface Props {
  projectId: string;
}

export function ProjectSummaryTab({ projectId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-summary', projectId],
    queryFn: () => api.get<{ data: SummaryData }>(`/projects/${projectId}/summary`),
  });

  if (isLoading) return <Spin />;
  const summary = data?.data;
  if (!summary) return null;

  return (
    <div>
      <Card
        size="small"
        style={{ marginBottom: 16, background: '#e6f4ff', border: '1px solid #91caff' }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong style={{ fontSize: 16 }}>Сводная смета по объекту</strong>
          <span style={{ color: '#8c8c8c' }}>
            {summary.estimates.length}{' '}
            {summary.estimates.length === 1
              ? 'смета'
              : summary.estimates.length >= 2 && summary.estimates.length <= 4
                ? 'сметы'
                : 'смет'}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ color: '#1677ff', fontWeight: 700, fontSize: 18 }}>
            ИТОГО: {formatMoney(summary.grandTotal)}
          </span>
        </div>
      </Card>

      {summary.estimates.length === 0 ? (
        <Empty description="В объекте нет смет" style={{ padding: '40px 0' }} />
      ) : (
        summary.estimates.map((est, i) => (
          <SummaryEstimateBlock key={est.id} estimate={est} index={i} />
        ))
      )}
    </div>
  );
}
