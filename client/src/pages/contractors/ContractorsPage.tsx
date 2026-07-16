import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Card, Row, Col, Tag, Empty, Spin, Space, Button, Tabs } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api, assetUrl } from '../../services/api';
import { placeholderCover } from '../../components/shared/placeholderCover';
import { useAuthStore } from '../../store/authStore';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { useProjectZones } from '../../hooks/useProjectLocations';
import { buildZoneIndex, type ZoneIndex } from '../estimates/components/LocationBadges';
import { formatMoney, type EstimateDetail, type EstimateItem } from '../estimates/components/types';
import { ContractorsSmetaTab } from './ContractorsSmetaTab';
import { ContractorsMaterialsTab } from './ContractorsMaterialsTab';
import { ContractorsRequestsTab } from './ContractorsRequestsTab';
import { useMaterialsSummary } from './materials/useMaterialsSummary';

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

/**
 * Сводка по объекту в шапке: постоянный ориентир на всех вкладках. Считается по всей доступной
 * пользователю смете и не зависит от отборов вкладки «Материалы».
 */
function MaterialsSummaryWidget({
  estimateId,
  items,
  viewerIsContractor,
  zoneIndex,
}: {
  estimateId: string;
  items: EstimateItem[];
  viewerIsContractor: boolean;
  zoneIndex: ZoneIndex;
}) {
  const { positions, orderedPositions, requestCount } = useMaterialsSummary(
    estimateId,
    items,
    viewerIsContractor,
    zoneIndex,
  );
  if (positions === 0) return null;
  return (
    <Space size={12} style={{ fontWeight: 400, fontSize: 13 }}>
      <span>
        <span style={{ color: '#8c8c8c' }}>Итого: </span>
        {positions} поз.
      </span>
      <span>
        <span style={{ color: '#8c8c8c' }}>Заказано: </span>
        {orderedPositions}
      </span>
      <span>
        <span style={{ color: '#8c8c8c' }}>Заказов: </span>
        {requestCount}
      </span>
    </Space>
  );
}

export function ContractorsPage() {
  const navigate = useNavigate();
  const { estimateId } = useParams<{ estimateId?: string }>();
  const [searchParams] = useSearchParams();
  const role = useAuthStore((s) => s.user?.role);
  const viewerIsContractor = role === 'contractor';
  const canAssign = role === 'admin' || role === 'engineer';
  const [tab, setTab] = usePersistedTab('estimat:contractors-tab', 'smeta');

  // Вкладка из ссылки (вход «Новая заявка» из раздела «Заявки») — один раз при открытии:
  // дальше пользователь переключает вкладки сам, и запомненная вкладка снова главнее.
  const tabParam = searchParams.get('tab');
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !tabParam) return;
    applied.current = true;
    setTab(tabParam);
  }, [tabParam, setTab]);

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

  const items: EstimateItem[] = viewerIsContractor
    ? contractorQ.data?.data.items ?? []
    : engineerQ.data?.data.items ?? [];

  // Объект строк: у инженера — из сметы, у подрядчика — из его первой строки (project_id есть в
  // выдаче my-items). Пока строк нет — projectId undefined, и зоны не запрашиваются.
  const projectId = viewerIsContractor ? items[0]?.project_id ?? undefined : engineerQ.data?.data.project_id;

  // Дерево зон объекта — для бейджей местоположения и отбора по корпусам (обе вкладки).
  const { data: zonesData } = useProjectZones(projectId ?? undefined);
  const zones = useMemo(() => zonesData?.data.roots ?? [], [zonesData]);
  // Индекс имён зон строим один раз на дерево: в своде материалов он нужен на каждое вхождение.
  const zoneIndex = useMemo(() => buildZoneIndex(zones), [zones]);

  // Список объектов
  if (!estimateId) {
    return (
      <Card
        title={viewerIsContractor ? 'Сметы' : 'Подрядчики'}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        styles={{ header: { paddingLeft: 48 }, body: { flex: 1, overflow: 'auto' } }}
      >
        <ObjectList />
      </Card>
    );
  }

  const isLoading = viewerIsContractor ? contractorQ.isLoading : engineerQ.isLoading;
  const refetch = viewerIsContractor ? contractorQ.refetch : engineerQ.refetch;
  const title = viewerIsContractor
    ? 'Назначенные мне работы'
    : engineerQ.data?.data
      ? `${engineerQ.data.data.project_code} · ${engineerQ.data.data.project_name}`
      : 'Смета';

  return (
    <Card
      title={
        <Space size={16}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/contractors')} />
          {title}
          <MaterialsSummaryWidget
            estimateId={estimateId}
            items={items}
            viewerIsContractor={viewerIsContractor}
            zoneIndex={zoneIndex}
          />
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
                  projectId={projectId ?? ''}
                  zones={zones}
                  zoneIndex={zoneIndex}
                  onChanged={() => refetch()}
                />
              ),
            },
            {
              key: 'materials',
              label: 'Материалы',
              children: (
                <ContractorsMaterialsTab
                  estimateId={estimateId}
                  items={items}
                  viewerIsContractor={viewerIsContractor}
                  isAdmin={role === 'admin'}
                  zones={zones}
                  zoneIndex={zoneIndex}
                />
              ),
            },
            {
              key: 'requests',
              label: 'Заявки',
              children: <ContractorsRequestsTab estimateId={estimateId} viewerIsContractor={viewerIsContractor} />,
            },
          ]}
        />
      )}
    </Card>
  );
}
