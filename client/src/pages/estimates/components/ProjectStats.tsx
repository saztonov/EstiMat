import { Row, Col, Statistic, Table, Divider, Spin, Empty, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

interface Bucket {
  works: number;
  materials: number;
}

interface AuthorStat {
  userId: string | null;
  name: string;
  today: Bucket;
  yesterday: Bucket;
  week: Bucket;
  month: Bucket;
  total: Bucket;
}

interface StatsResponse {
  totals: { categories: number; types: number; works: number; materials: number };
  byAuthor: AuthorStat[];
}

interface Props {
  projectId: string;
}

// Ячейка периода: «работы (материалы)», напр. «4 (2)».
const fmt = (b: Bucket) => `${b.works} (${b.materials})`;

// Тело модалки «Статистика»: итоги по смете объекта + разбивка по авторам
// (сколько строк работ/материалов добавил каждый по периодам).
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
    { title: 'Сегодня', key: 'today', align: 'right', width: 100, render: (_, r) => fmt(r.today) },
    { title: 'Вчера', key: 'yesterday', align: 'right', width: 100, render: (_, r) => fmt(r.yesterday) },
    { title: 'Неделя', key: 'week', align: 'right', width: 100, render: (_, r) => fmt(r.week) },
    { title: 'Месяц', key: 'month', align: 'right', width: 100, render: (_, r) => fmt(r.month) },
    { title: 'Всего', key: 'total', align: 'right', width: 100, render: (_, r) => fmt(r.total) },
  ];

  return (
    <div>
      <Row gutter={[16, 12]}>
        <Col xs={12} sm={6}><Statistic title="Категорий" value={totals.categories} /></Col>
        <Col xs={12} sm={6}><Statistic title="Видов" value={totals.types} /></Col>
        <Col xs={12} sm={6}><Statistic title="Наименований" value={totals.works} /></Col>
        <Col xs={12} sm={6}><Statistic title="Материалов" value={totals.materials} /></Col>
      </Row>

      <Divider style={{ margin: '16px 0 4px' }} orientation="left">По авторам</Divider>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        Формат ячейки: работ (материалов)
      </Typography.Text>

      {authors.length === 0 ? (
        <Empty description="Работы не добавлены" />
      ) : (
        <Table
          size="small"
          rowKey={(r) => r.userId ?? 'none'}
          columns={columns}
          dataSource={authors}
          pagination={false}
          scroll={{ x: 640 }}
        />
      )}
    </div>
  );
}
