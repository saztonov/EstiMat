import { useParams, useNavigate, useSearchParams } from 'react-router';
import { Card, Descriptions, Tag, Button, Spin, Tabs } from 'antd';
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
  const activeTab = searchParams.get('tab') || 'info';

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
      key: 'info',
      label: 'Информация',
      children: (
        <Descriptions column={2} bordered size="small" style={{ marginTop: 8 }}>
          <Descriptions.Item label="Код">{project.code as string}</Descriptions.Item>
          <Descriptions.Item label="Статус">
            <Tag>{PROJECT_STATUS_LABELS[(project.status as string) as keyof typeof PROJECT_STATUS_LABELS]}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Название">{project.name as string}</Descriptions.Item>
          <Descriptions.Item label="Полное название">{(project.full_name as string) || '—'}</Descriptions.Item>
          <Descriptions.Item label="Адрес">{(project.address as string) || '—'}</Descriptions.Item>
          <Descriptions.Item label="Начало">{(project.start_date as string) || '—'}</Descriptions.Item>
          <Descriptions.Item label="Окончание">{(project.end_date as string) || '—'}</Descriptions.Item>
        </Descriptions>
      ),
    },
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
        <span>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/estimates')}
            style={{ marginRight: 8 }}
          />
          {project.code as string} — {project.name as string}
        </span>
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
