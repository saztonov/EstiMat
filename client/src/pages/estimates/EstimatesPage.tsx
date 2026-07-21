import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, Row, Col, Input, Select, Empty, Spin, Space, Button, Modal, Tooltip, App } from 'antd';
import { SearchOutlined, BarChartOutlined, FileTextOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api, assetUrl } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { BuildingsIcon } from '../../components/shared/BuildingsIcon';
import { placeholderCover } from '../../components/shared/placeholderCover';
import { LocationBuilder } from '../projects/LocationBuilder';
import { ProjectStats } from './components/ProjectStats';
import { AllProjectsStats } from './components/AllProjectsStats';
import { CiphersModal } from './components/CiphersModal';

interface ProjectWithStats {
  id: string;
  code: string;
  name: string;
  full_name: string | null;
  address: string | null;
  status: string;
  image_url: string | null;
  image_src: string | null;
  estimates_count: number;
  estimates_total: string;
  works_count: number;
}

const formatMoney = (v: string | number) =>
  `${Number(v ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;

export function EstimatesPage() {
  const navigate = useNavigate();
  const { modal } = App.useApp();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'code' | 'name' | 'total'>('code');
  const [builderProjectId, setBuilderProjectId] = useState<string | null>(null);
  const [builderDirty, setBuilderDirty] = useState(false);
  const [statsProjectId, setStatsProjectId] = useState<string | null>(null);
  const [ciphersProjectId, setCiphersProjectId] = useState<string | null>(null);
  const [allStatsOpen, setAllStatsOpen] = useState(false);

  const openBuilder = (id: string) => { setBuilderDirty(false); setBuilderProjectId(id); };
  const closeBuilder = () => {
    if (builderDirty) {
      modal.confirm({
        title: 'Закрыть без сохранения?',
        content: 'Есть несохранённые изменения местоположения.',
        okText: 'Закрыть',
        cancelText: 'Остаться',
        onOk: () => { setBuilderDirty(false); setBuilderProjectId(null); },
      });
    } else {
      setBuilderProjectId(null);
    }
  };

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
        default: return a.code.localeCompare(b.code);
      }
    });
  }, [data, search, sort]);

  return (
    <>
    <Card
      title="Строительные объекты"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' } }}
    >
      <Space className="estimat-toolbar" style={{ marginBottom: 16 }} wrap>
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
          ]}
        />
        <Button icon={<BarChartOutlined />} onClick={() => setAllStatsOpen(true)}>
          Статистика
        </Button>
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
                  p.image_src ?? p.image_url
                    ? <img alt={p.name} src={assetUrl(p.image_src ?? p.image_url)} style={{ height: 140, objectFit: 'cover' }} />
                    : placeholderCover(p.code)
                }
                onClick={() => navigate(`/projects/${p.id}`)}
                styles={{ body: { padding: 16 } }}
              >
                <div style={{ marginBottom: 6 }}>
                  <strong>{p.code} · {p.name}</strong>
                </div>
                <div style={{ color: 'var(--est-text-tertiary)', fontSize: 13, marginBottom: 12, minHeight: 18 }}>
                  {p.address || '—'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <Space size={0} wrap>
                    <Tooltip title="Местоположение">
                      <Button
                        type="text"
                        size="small"
                        icon={<BuildingsIcon />}
                        style={{ paddingInline: 6, color: 'var(--est-text-secondary)' }}
                        onClick={(e) => { e.stopPropagation(); openBuilder(p.id); }}
                      />
                    </Tooltip>
                    <Tooltip title="Шифры рабочей документации">
                      <Button
                        type="text"
                        size="small"
                        icon={<FileTextOutlined />}
                        style={{ paddingInline: 6, color: 'var(--est-text-secondary)' }}
                        onClick={(e) => { e.stopPropagation(); setCiphersProjectId(p.id); }}
                      />
                    </Tooltip>
                    <Tooltip title="Статистика по объекту">
                      <Button
                        type="text"
                        size="small"
                        icon={<BarChartOutlined />}
                        style={{ paddingInline: 6, color: 'var(--est-text-secondary)' }}
                        onClick={(e) => { e.stopPropagation(); setStatsProjectId(p.id); }}
                      >
                        {p.works_count}
                      </Button>
                    </Tooltip>
                  </Space>
                  <strong style={{ color: 'var(--est-primary)' }}>{formatMoney(p.estimates_total)}</strong>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Card>

      <Modal
        title="Местоположение"
        open={!!builderProjectId}
        onCancel={closeBuilder}
        footer={null}
        width="90%"
        style={{ top: 24 }}
        styles={{ body: { height: 'calc(100vh - 180px)', overflow: 'hidden' } }}
      >
        {builderProjectId && (
          <LocationBuilder projectId={builderProjectId} onDirtyChange={setBuilderDirty} />
        )}
      </Modal>

      <Modal
        title="Статистика"
        open={!!statsProjectId}
        onCancel={() => setStatsProjectId(null)}
        footer={null}
        width={modalWidth(720)}
        style={{ top: 40 }}
      >
        {statsProjectId && <ProjectStats projectId={statsProjectId} />}
      </Modal>

      <Modal
        title="Шифры рабочей документации"
        open={!!ciphersProjectId}
        onCancel={() => setCiphersProjectId(null)}
        footer={null}
        width={modalWidth(560)}
        style={{ top: 40 }}
      >
        {ciphersProjectId && <CiphersModal projectId={ciphersProjectId} />}
      </Modal>

      <Modal
        title="Статистика по всем объектам"
        open={allStatsOpen}
        onCancel={() => setAllStatsOpen(false)}
        footer={null}
        width={modalWidth(1082)}
        style={{ top: 40 }}
      >
        <AllProjectsStats enabled={allStatsOpen} />
      </Modal>
    </>
  );
}
