import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, Row, Col, Input, Select, Tag, Empty, Spin, Space } from 'antd';
import { SearchOutlined, FileTextOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { PROJECT_STATUS_LABELS } from '@estimat/shared';

interface ProjectWithStats {
  id: string;
  code: string;
  name: string;
  full_name: string | null;
  address: string | null;
  status: string;
  image_url: string | null;
  estimates_count: number;
  estimates_total: string;
}

const statusColors: Record<string, string> = {
  planning: 'default',
  active: 'blue',
  completed: 'green',
  archived: 'orange',
};

const formatMoney = (v: string | number) =>
  `${Number(v ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;

const placeholderCover = (code: string) => {
  const hue = (code.charCodeAt(0) * 37) % 360;
  return (
    <div
      style={{
        height: 140,
        background: `linear-gradient(135deg, hsl(${hue},60%,55%), hsl(${(hue + 40) % 360},60%,45%))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.85)',
        fontSize: 40,
      }}
    >
      <FileTextOutlined />
    </div>
  );
};

export function EstimatesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'code' | 'name' | 'total' | 'count'>('code');

  const { data, isLoading } = useQuery({
    queryKey: ['projects-with-stats'],
    queryFn: () => api.get<{ data: ProjectWithStats[] }>('/projects/with-stats'),
  });

  const projects = useMemo(() => {
    const rows = data?.data ?? [];
    const filtered = search.trim()
      ? rows.filter((p) => {
          const q = search.trim().toLowerCase();
          return (
            p.code.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            (p.address || '').toLowerCase().includes(q)
          );
        })
      : rows;

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'name': return a.name.localeCompare(b.name);
        case 'total': return Number(b.estimates_total) - Number(a.estimates_total);
        case 'count': return b.estimates_count - a.estimates_count;
        default: return a.code.localeCompare(b.code);
      }
    });
  }, [data, search, sort]);

  return (
    <Card
      title="Строительные объекты"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' } }}
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Поиск по коду, названию, адресу"
          style={{ width: 340 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={sort}
          onChange={setSort}
          style={{ width: 200 }}
          options={[
            { value: 'code', label: 'Сортировка: по коду' },
            { value: 'name', label: 'Сортировка: по названию' },
            { value: 'total', label: 'Сортировка: по сумме' },
            { value: 'count', label: 'Сортировка: по числу смет' },
          ]}
        />
      </Space>

      {isLoading ? (
        <Spin size="large" />
      ) : projects.length === 0 ? (
        <Empty description="Объектов не найдено" />
      ) : (
        <Row gutter={[16, 16]}>
          {projects.map((p) => (
            <Col key={p.id} xs={24} sm={12} lg={8} xl={6}>
              <Card
                hoverable
                cover={
                  p.image_url
                    ? <img alt={p.name} src={p.image_url} style={{ height: 140, objectFit: 'cover' }} />
                    : placeholderCover(p.code)
                }
                onClick={() => navigate(`/projects/${p.id}?tab=estimates`)}
                styles={{ body: { padding: 16 } }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong>{p.code} · {p.name}</strong>
                  <Tag color={statusColors[p.status]} style={{ marginInlineEnd: 0 }}>
                    {PROJECT_STATUS_LABELS[p.status as keyof typeof PROJECT_STATUS_LABELS]}
                  </Tag>
                </div>
                <div style={{ color: '#8c8c8c', fontSize: 13, marginBottom: 12, minHeight: 18 }}>
                  {p.address || '—'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ color: '#8c8c8c' }}>
                    <FileTextOutlined /> {p.estimates_count} смет
                  </span>
                  <strong style={{ color: '#1677ff' }}>{formatMoney(p.estimates_total)}</strong>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
}
