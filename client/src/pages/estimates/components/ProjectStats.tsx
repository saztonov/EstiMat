import { Row, Col, Statistic, Table, Divider, Spin, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

interface AuthorStat {
  userId: string | null;
  name: string;
  categories: number;
  types: number;
  works: number;
  materials: number;
}

interface StatsResponse {
  totals: { categories: number; types: number; works: number; materials: number };
  byAuthor: AuthorStat[];
}

interface Props {
  projectId: string;
}

// Тело модалки «Статистика»: итоги по смете объекта + разбивка по авторам.
// Данные подгружаются лениво (запрос включается только при заданном projectId).
export function ProjectStats({ projectId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-stats', projectId],
    queryFn: () => api.get<{ data: StatsResponse }>(`/projects/${projectId}/stats`),
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <Spin />
      </div>
    );
  }

  const totals = data?.data.totals ?? { categories: 0, types: 0, works: 0, materials: 0 };
  const authors = data?.data.byAuthor ?? [];

  const columns: ColumnsType<AuthorStat> = [
    { title: 'Автор', dataIndex: 'name', key: 'name' },
    { title: 'Категорий', dataIndex: 'categories', key: 'categories', align: 'right', width: 110 },
    { title: 'Видов', dataIndex: 'types', key: 'types', align: 'right', width: 90 },
    { title: 'Наименований', dataIndex: 'works', key: 'works', align: 'right', width: 130 },
    { title: 'Материалов', dataIndex: 'materials', key: 'materials', align: 'right', width: 120 },
  ];

  return (
    <div>
      <Row gutter={16}>
        <Col span={6}><Statistic title="Категорий" value={totals.categories} /></Col>
        <Col span={6}><Statistic title="Видов" value={totals.types} /></Col>
        <Col span={6}><Statistic title="Наименований" value={totals.works} /></Col>
        <Col span={6}><Statistic title="Материалов" value={totals.materials} /></Col>
      </Row>

      <Divider style={{ margin: '16px 0 12px' }} orientation="left">По авторам</Divider>

      {authors.length === 0 ? (
        <Empty description="Работы не добавлены" />
      ) : (
        <Table
          size="small"
          rowKey={(r) => r.userId ?? 'none'}
          columns={columns}
          dataSource={authors}
          pagination={false}
        />
      )}
    </div>
  );
}
