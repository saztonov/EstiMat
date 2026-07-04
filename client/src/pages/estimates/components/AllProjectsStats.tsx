import { Row, Col, Statistic, Table, Divider, Spin, Empty, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

interface Bucket {
  works: number;
  materials: number;
}

interface Periods {
  today: Bucket;
  yesterday: Bucket;
  week: Bucket;
  month: Bucket;
  total: Bucket;
}

interface ProjectStat extends Periods {
  projectId: string;
  code: string;
  name: string;
}

interface AuthorStat extends Periods {
  userId: string | null;
  name: string;
  byProject: ProjectStat[];
}

interface StatsResponse {
  totals: { categories: number; types: number; works: number; materials: number };
  byAuthor: AuthorStat[];
}

// Строка tree-таблицы: родитель — автор (суммы по всем объектам),
// дочерние строки — детализация по объектам.
interface StatRow extends Periods {
  key: string;
  author: string;
  project: string;
  isAuthor: boolean;
  children?: StatRow[];
}

// Ячейка периода: «работы (материалы)», напр. «4 (2)».
const fmt = (b: Bucket) => `${b.works} (${b.materials})`;

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

// Тело модалки «Статистика по всем объектам»: глобальные итоги + таблица
// по авторам, где «+» у автора раскрывает разбивку по объектам.
// Данные подгружаются лениво (запрос включается только при открытой модалке).
export function AllProjectsStats({ enabled }: { enabled: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['projects-stats-all'],
    queryFn: () => api.get<{ data: StatsResponse }>('/projects/stats'),
    enabled,
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

  const rows: StatRow[] = authors.map((a) => {
    const authorKey = a.userId ?? 'none';
    return {
      key: authorKey,
      author: a.name,
      project: `${a.byProject.length} ${plural(a.byProject.length, 'объект', 'объекта', 'объектов')}`,
      isAuthor: true,
      today: a.today,
      yesterday: a.yesterday,
      week: a.week,
      month: a.month,
      total: a.total,
      children: a.byProject.map((p) => ({
        key: `${authorKey}:${p.projectId}`,
        author: '',
        project: `${p.code} · ${p.name}`,
        isAuthor: false,
        today: p.today,
        yesterday: p.yesterday,
        week: p.week,
        month: p.month,
        total: p.total,
      })),
    };
  });

  const columns: ColumnsType<StatRow> = [
    { title: 'Автор', dataIndex: 'author', key: 'author', width: 270 },
    {
      title: 'Объект',
      dataIndex: 'project',
      key: 'project',
      render: (v: string, r) =>
        r.isAuthor ? <Typography.Text type="secondary">{v}</Typography.Text> : v,
    },
    { title: 'Сегодня', key: 'today', align: 'right', width: 100, render: (_, r) => fmt(r.today) },
    { title: 'Вчера', key: 'yesterday', align: 'right', width: 100, render: (_, r) => fmt(r.yesterday) },
    { title: 'Неделя', key: 'week', align: 'right', width: 100, render: (_, r) => fmt(r.week) },
    { title: 'Месяц', key: 'month', align: 'right', width: 100, render: (_, r) => fmt(r.month) },
    { title: 'Всего', key: 'total', align: 'right', width: 100, render: (_, r) => fmt(r.total) },
  ];

  return (
    <div>
      <Row gutter={16}>
        <Col span={6}><Statistic title="Категорий" value={totals.categories} /></Col>
        <Col span={6}><Statistic title="Видов" value={totals.types} /></Col>
        <Col span={6}><Statistic title="Наименований" value={totals.works} /></Col>
        <Col span={6}><Statistic title="Материалов" value={totals.materials} /></Col>
      </Row>

      <Divider style={{ margin: '16px 0 4px' }} orientation="left">По авторам</Divider>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        Формат ячейки: работ (материалов)
      </Typography.Text>

      {rows.length === 0 ? (
        <Empty description="Работы не добавлены" />
      ) : (
        <Table
          size="small"
          rowKey="key"
          columns={columns}
          dataSource={rows}
          pagination={false}
        />
      )}
    </div>
  );
}
