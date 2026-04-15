import { useParams, useNavigate, useSearchParams } from 'react-router';
import { Card, Tag, Button, Spin, Tabs, Space } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { PROJECT_STATUS_LABELS } from '@estimat/shared';
import { ProjectEstimatesTab } from './components/ProjectEstimatesTab';
import { ProjectSummaryTab } from './components/ProjectSummaryTab';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'estimates';

  const { data, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<{ data: Record<string, unknown> }>(`/projects/${id}`),
    enabled: !!id,
  });

  if (isLoading) return <Spin size="large" />;

  const project = data?.data;
  if (!project) return <div>Проект не найден</div>;

  const tabs = [
    {
      key: 'estimates',
      label: 'Сметы',
      children: id ? <ProjectEstimatesTab projectId={id} /> : null,
    },
    {
      key: 'summary',
      label: 'Сводная смета',
      children: id ? <ProjectSummaryTab projectId={id} /> : null,
    },
  ];

  return (
    <Card
      title={
        <Space size={12} wrap>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/estimates')}
          />
          <span>{project.code as string} — {project.name as string}</span>
          <Tag>{PROJECT_STATUS_LABELS[(project.status as string) as keyof typeof PROJECT_STATUS_LABELS]}</Tag>
          {project.address ? (
            <span style={{ color: '#8c8c8c', fontWeight: 'normal' }}>
              · {project.address as string}
            </span>
          ) : null}
        </Space>
      }
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 24px 24px' } }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams({ tab: key })}
        items={tabs}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      />
    </Card>
  );
}
