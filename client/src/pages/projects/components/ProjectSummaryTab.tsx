import { Table, Tag, Spin } from 'antd';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { ESTIMATE_STATUS_LABELS } from '@estimat/shared';

const statusColors: Record<string, string> = {
  draft: 'default',
  review: 'blue',
  approved: 'green',
  archived: 'orange',
};

interface SummaryData {
  project: Record<string, unknown>;
  estimates: Array<{
    id: string;
    work_type: string | null;
    status: string;
    total_amount: string;
    created_at: string;
    cost_category_name: string | null;
  }>;
  grandTotal: number;
}

interface Props {
  projectId: string;
}

const formatMoney = (v: number | string) =>
  `${Number(v ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;

export function ProjectSummaryTab({ projectId }: Props) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['project-summary', projectId],
    queryFn: () => api.get<{ data: SummaryData }>(`/projects/${projectId}/summary`),
  });

  if (isLoading) return <Spin />;
  const summary = data?.data;
  if (!summary) return null;

  const columns = [
    { title: '№', width: 60, render: (_v: unknown, _r: unknown, i: number) => i + 1 },
    {
      title: 'Вид работ',
      dataIndex: 'work_type',
      render: (v: string) => v || '—',
    },
    {
      title: 'Категория затрат',
      dataIndex: 'cost_category_name',
      render: (v: string) => v || '—',
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 130,
      render: (s: string) => <Tag color={statusColors[s]}>{ESTIMATE_STATUS_LABELS[s as keyof typeof ESTIMATE_STATUS_LABELS]}</Tag>,
    },
    {
      title: 'Сумма',
      dataIndex: 'total_amount',
      width: 180,
      align: 'right' as const,
      render: (v: string) => formatMoney(v),
    },
  ];

  return (
    <div className="table-page-wrapper">
      <Table
        rowKey="id"
        columns={columns}
        dataSource={summary.estimates}
        pagination={false}
        scroll={{ y: 'flex' }}
        onRow={(r) => ({ onClick: () => navigate(`/estimates/${r.id}`) })}
        style={{ cursor: 'pointer' }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={4} align="right">
              <strong>ИТОГО ПО ОБЪЕКТУ:</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right">
              <strong style={{ color: '#1677ff' }}>{formatMoney(summary.grandTotal)}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </div>
  );
}
