import { useNavigate, useParams } from 'react-router';
import { Card, Row, Col, Tag, Empty, Spin, Space, Button, Tabs } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api, assetUrl } from '../../services/api';
import { placeholderCover } from '../../components/shared/placeholderCover';
import { useAuthStore } from '../../store/authStore';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { formatMoney, type EstimateDetail, type EstimateItem } from '../estimates/components/types';
import { ContractorsSmetaTab } from './ContractorsSmetaTab';
import { ContractorsMaterialsTab } from './ContractorsMaterialsTab';

// Строка списка объектов раздела (поля зависят от роли — см. /api/contractors/estimates).
// Карточка = объект; у объекта одна смета (estimate_id = null, если смета не заведена).
interface ContractorEstimateRow {
  estimate_id: string | null;
  project_id: string;
  project_code: string;
  project_name: string;
  address: string | null;
  image_url: string | null;
  image_src: string | null;
  work_type: string | null;
  cost_category_name: string | null;
  items_total: number;
  // инженер/админ:
  items_assigned?: number;
  items_unassigned?: number;
  unassigned_amount?: string;
  // подрядчик:
  my_amount?: string;
}

function ObjectList() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['contractor-estimates'],
    queryFn: () => api.get<{ data: ContractorEstimateRow[] }>('/contractors/estimates'),
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <Spin size="large" />;
  const rows = data?.data ?? [];
  if (rows.length === 0) return <Empty description="Объектов нет" />;

  return (
    <Row gutter={[16, 16]}>
      {rows.map((r) => {
        const clickable = r.estimate_id != null;
        const src = assetUrl(r.image_src ?? r.image_url);
        return (
        <Col key={r.project_id} xs={24} sm={12} lg={8} xl={6}>
          <Card
            hoverable={clickable}
            cover={
              src
                ? <img alt={r.project_name} src={src} style={{ height: 140, objectFit: 'cover' }} />
                : placeholderCover(r.project_code)
            }
            onClick={clickable ? () => navigate(`/contractors/${r.estimate_id}`) : undefined}
            styles={{ body: { padding: 16 } }}
          >
            <div style={{ marginBottom: 6 }}>
              <strong>{r.project_code} · {r.project_name}</strong>
            </div>
            <div style={{ color: '#8c8c8c', fontSize: 13, marginBottom: 12, minHeight: 18 }}>
              {r.address || '—'}
            </div>
            {r.items_unassigned != null ? (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color="blue">Всего строк: {r.items_total}</Tag>
                  <Tag color="green">Назначено: {r.items_assigned ?? 0}</Tag>
                  {(r.items_unassigned ?? 0) > 0 && <Tag color="orange">Без подрядчика: {r.items_unassigned}</Tag>}
                </Space>
                {Number(r.unassigned_amount ?? 0) > 0 && (
                  <span style={{ color: '#fa8c16' }}>Нераспределено: {formatMoney(r.unassigned_amount)}</span>
                )}
              </Space>
            ) : (
              <Space wrap>
                <Tag color="blue">Мои строки: {r.items_total}</Tag>
                <span style={{ color: '#1677ff' }}>{formatMoney(r.my_amount)}</span>
              </Space>
            )}
          </Card>
        </Col>
        );
      })}
    </Row>
  );
}

export function ContractorsPage() {
  const navigate = useNavigate();
  const { estimateId } = useParams<{ estimateId?: string }>();
  const role = useAuthStore((s) => s.user?.role);
  const viewerIsContractor = role === 'contractor';
  const canAssign = role === 'admin' || role === 'engineer';
  const [tab, setTab] = usePersistedTab('estimat:contractors-tab', 'smeta');

  const engineerQ = useQuery({
    queryKey: ['estimate', estimateId],
    queryFn: () => api.get<{ data: EstimateDetail }>(`/estimates/${estimateId}`),
    enabled: !!estimateId && !viewerIsContractor,
    refetchOnWindowFocus: true,
  });
  const contractorQ = useQuery({
    queryKey: ['contractor-my-items', estimateId],
    queryFn: () => api.get<{ data: { items: EstimateItem[] } }>(`/contractors/my-items?estimateId=${estimateId}`),
    enabled: !!estimateId && viewerIsContractor,
    refetchOnWindowFocus: true,
  });

  // Список объектов
  if (!estimateId) {
    return (
      <Card
        title="Подрядчики"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        styles={{ header: { paddingLeft: 48 }, body: { flex: 1, overflow: 'auto' } }}
      >
        <ObjectList />
      </Card>
    );
  }

  const isLoading = viewerIsContractor ? contractorQ.isLoading : engineerQ.isLoading;
  const items: EstimateItem[] = viewerIsContractor
    ? contractorQ.data?.data.items ?? []
    : engineerQ.data?.data.items ?? [];
  const refetch = viewerIsContractor ? contractorQ.refetch : engineerQ.refetch;
  const title = viewerIsContractor
    ? 'Назначенные мне работы'
    : engineerQ.data?.data
      ? `${engineerQ.data.data.project_code} · ${engineerQ.data.data.project_name}`
      : 'Смета';

  return (
    <Card
      title={
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/contractors')} />
          {title}
        </Space>
      }
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ header: { paddingLeft: 48 }, body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
    >
      {isLoading ? (
        <Spin size="large" />
      ) : (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'smeta',
              label: 'Смета',
              children: (
                <ContractorsSmetaTab
                  estimateId={estimateId}
                  items={items}
                  canAssign={canAssign}
                  viewerIsContractor={viewerIsContractor}
                  onChanged={() => refetch()}
                />
              ),
            },
            {
              key: 'materials',
              label: 'Материалы',
              children: <ContractorsMaterialsTab items={items} viewerIsContractor={viewerIsContractor} />,
            },
          ]}
        />
      )}
    </Card>
  );
}
