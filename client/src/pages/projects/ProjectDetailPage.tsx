import { useParams, useNavigate } from 'react-router';
import { Card, Descriptions, Tag, Button, Spin } from 'antd';
import { ArrowLeftOutlined, FileTextOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { PROJECT_STATUS_LABELS } from '@estimat/shared';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<{ data: Record<string, unknown> }>(`/projects/${id}`),
  });

  if (isLoading) return <Spin size="large" />;

  const project = data?.data;
  if (!project) return <div>Проект не найден</div>;

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')} style={{ marginBottom: 16 }}>
        К списку проектов
      </Button>
      <Card
        title={`${project.code} — ${project.name}`}
        extra={
          <Button type="primary" icon={<FileTextOutlined />} onClick={() => navigate(`/estimates?projectId=${id}`)}>
            Сметы проекта
          </Button>
        }
      >
        <Descriptions column={2}>
          <Descriptions.Item label="Код">{project.code as string}</Descriptions.Item>
          <Descriptions.Item label="Статус">
            <Tag>{PROJECT_STATUS_LABELS[(project.status as string) as keyof typeof PROJECT_STATUS_LABELS]}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Полное название">{(project.full_name as string) || '—'}</Descriptions.Item>
          <Descriptions.Item label="Адрес">{(project.address as string) || '—'}</Descriptions.Item>
          <Descriptions.Item label="Начало">{(project.start_date as string) || '—'}</Descriptions.Item>
          <Descriptions.Item label="Окончание">{(project.end_date as string) || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
