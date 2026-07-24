import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Card, Row, Col, Tag, Empty, Spin, Space, Button, Tabs, Tooltip } from 'antd';
import { ArrowLeftOutlined, FileExcelOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api, assetUrl } from '../../services/api';
import { placeholderCover } from '../../components/shared/placeholderCover';
import { useAuthStore } from '../../store/authStore';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { useProjectZones } from '../../hooks/useProjectLocations';
import { buildZoneIndex, type ZoneIndex } from '../estimates/components/LocationBadges';
import type { CostTypeCiphers, EstimateDetail, EstimateItem } from '../estimates/components/types';
import { ContractorsSmetaTab } from './ContractorsSmetaTab';
import { ContractorsMaterialsTab } from './ContractorsMaterialsTab';
import { ContractorsRequestsTab } from './ContractorsRequestsTab';
import { VorObjectListModal, type ContractFilter } from './vor/VorObjectListModal';
import { dedupeContracts, formatContractLabel, type ContractRef } from './vor/contractLabel';
import { useMaterialsSummary } from './materials/useMaterialsSummary';

// Строка списка объектов раздела (поля зависят от роли — см. /api/contractors/estimates).
// Карточка = объект; у объекта одна смета (estimate_id = null, если смета не заведена).
// Денежных итогов здесь нет: раздел про раздачу работ подрядчикам, а не про суммы.
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
  // инженер/админ/руководитель:
  vors_total?: number;
  vors_assigned?: number;
  // подрядчик — его собственные договорные связки по этому объекту:
  contracts?: ContractRef[];
}

// Бейдж в две строки: показатели читаются парой, поэтому строки — блочные элементы (Tag сам по
// себе не переносит содержимое), а высота строки фиксирована, чтобы бейджи стояли вровень.
const stackTag: CSSProperties = { marginInlineEnd: 0, lineHeight: '18px', padding: '2px 8px' };

/** Ключи вкладок карточки сметы — ими же валидируется ?tab из ссылки. */
const TAB_KEYS = ['smeta', 'materials', 'requests'];

/** Договоры подрядчика по объекту: число — в бейдже, реквизиты — в подсказке. */
function ContractsTag({ contracts }: { contracts: ContractRef[] }) {
  return (
    <Tooltip
      title={
        contracts.length === 0 ? (
          'Договоров нет'
        ) : (
          // Список, а не строка с \n: перенос в подсказке иначе не гарантирован. Договоров по
          // объекту бывает много — ограничиваем высоту вместо подсказки во весь экран.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
            {contracts.map((c, i) => (
              <span key={`${c.number ?? ''}|${c.date ?? ''}|${i}`}>{formatContractLabel(c)}</span>
            ))}
          </div>
        )
      }
    >
      <Tag color="geekblue">Договоров: {contracts.length}</Tag>
    </Tooltip>
  );
}

function ObjectList({ viewerIsContractor }: { viewerIsContractor: boolean }) {
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
        const vorsTotal = r.vors_total ?? 0;
        const vorsAssigned = r.vors_assigned ?? 0;
        const vorsUnassigned = Math.max(0, vorsTotal - vorsAssigned);
        // Один договор нередко раздан на несколько ВОР — для подрядчика это один договор.
        const contracts = dedupeContracts(r.contracts ?? []);
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
            <div style={{ color: 'var(--est-text-tertiary)', fontSize: 13, marginBottom: 12, minHeight: 18 }}>
              {r.address || '—'}
            </div>
            {viewerIsContractor ? (
              <Space wrap size={8}>
                <ContractsTag contracts={contracts} />
                <Tag color="blue">Мои строки: {r.items_total}</Tag>
              </Space>
            ) : (
              <Space wrap size={8}>
                <Tag color="blue" style={stackTag}>
                  <div>Всего строк: {r.items_total}</div>
                  <div>Всего ВОРов: {vorsTotal}</div>
                </Tag>
                <Tag color={vorsUnassigned > 0 ? 'orange' : 'green'} style={stackTag}>
                  <div>Назначено ВОР: {vorsAssigned}</div>
                  <div>Не назначено ВОР: {vorsUnassigned}</div>
                </Tag>
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
        <span style={{ color: 'var(--est-text-tertiary)' }}>Итого: </span>
        {positions} поз.
      </span>
      <span>
        <span style={{ color: 'var(--est-text-tertiary)' }}>Заказано: </span>
        {orderedPositions}
      </span>
      <span>
        <span style={{ color: 'var(--est-text-tertiary)' }}>Заказов: </span>
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
  // Руководитель уравнен в правах с инженером-сметчиком: назначает подрядчиков и видит цены.
  const canAssign = role === 'admin' || role === 'engineer' || role === 'manager';
  const [tab, setTab] = usePersistedTab('estimat:contractors-tab', 'smeta');
  const [vorListOpen, setVorListOpen] = useState(false);
  // Отбор «строки одного договора» из реестра ВОР. Живёт на странице: реестр после перехода
  // закрывается, а отбор должен остаться на вкладке «Смета».
  const [contractFilter, setContractFilter] = useState<ContractFilter | null>(null);

  // Вкладка из ссылки (вход «Новая заявка» из раздела «Заявки») — один раз при открытии и только
  // на время этого визита: в localStorage не пишем, иначе разовый переход по ссылке молча сменил
  // бы вкладку по умолчанию для всех будущих заходов в раздел.
  const tabParam = searchParams.get('tab');
  const [tabOverride, setTabOverride] = useState<string | null>(
    TAB_KEYS.includes(tabParam ?? '') ? tabParam : null,
  );
  const activeTab = tabOverride ?? tab;
  const onTabChange = (key: string) => {
    setTabOverride(null);
    setTab(key);
  };

  // Переход к строкам договора: реестр закрывается, вкладка «Смета» показывает только их.
  const showContract = (filter: ContractFilter) => {
    setContractFilter(filter);
    setVorListOpen(false);
    setTabOverride(null);
    setTab('smeta');
  };

  const engineerQ = useQuery({
    queryKey: ['estimate', estimateId],
    queryFn: () => api.get<{ data: EstimateDetail }>(`/estimates/${estimateId}`),
    enabled: !!estimateId && !viewerIsContractor,
    refetchOnWindowFocus: true,
  });
  const contractorQ = useQuery({
    queryKey: ['contractor-my-items', estimateId],
    queryFn: () =>
      api.get<{
        data: {
          items: EstimateItem[];
          cost_type_ciphers: CostTypeCiphers;
          project_id: string | null;
          project_name: string | null;
        };
      }>(`/contractors/my-items?estimateId=${estimateId}`),
    enabled: !!estimateId && viewerIsContractor,
    refetchOnWindowFocus: true,
  });

  const items: EstimateItem[] = viewerIsContractor
    ? contractorQ.data?.data.items ?? []
    : engineerQ.data?.data.items ?? [];

  // Шифры РД по видам работ: у инженера из детализации сметы, у подрядчика — из my-items
  // (справочник шифров объекта ему закрыт).
  const costTypeCiphers: CostTypeCiphers = useMemo(
    () =>
      (viewerIsContractor
        ? contractorQ.data?.data.cost_type_ciphers
        : engineerQ.data?.data.cost_type_ciphers) ?? {},
    [viewerIsContractor, contractorQ.data, engineerQ.data],
  );

  // Объект строк: у инженера — из сметы, у подрядчика — из метаданных my-items (по estimateId, не из
  // строк — надёжнее при пустом наборе). Пока не загрузилось — projectId undefined, зоны не грузятся.
  const projectId = viewerIsContractor
    ? contractorQ.data?.data.project_id ?? undefined
    : engineerQ.data?.data.project_id;

  // Дерево зон объекта — для бейджей местоположения и отбора по корпусам (обе вкладки).
  const { data: zonesData } = useProjectZones(projectId ?? undefined);
  const zones = useMemo(() => zonesData?.data.roots ?? [], [zonesData]);
  // Индекс имён зон строим один раз на дерево: в своде материалов он нужен на каждое вхождение.
  const zoneIndex = useMemo(() => buildZoneIndex(zones), [zones]);

  // Отбор договора привязан к ВОР конкретной сметы — при переходе на другой объект он бессмыслен.
  useEffect(() => {
    setContractFilter(null);
  }, [estimateId]);

  // Список объектов
  if (!estimateId) {
    return (
      <Card
        title={viewerIsContractor ? 'Сметы' : 'Подрядчики'}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        styles={{ header: { paddingLeft: 48 }, body: { flex: 1, overflow: 'auto' } }}
      >
        <ObjectList viewerIsContractor={viewerIsContractor} />
      </Card>
    );
  }

  const isLoading = viewerIsContractor ? contractorQ.isLoading : engineerQ.isLoading;
  const refetch = viewerIsContractor ? contractorQ.refetch : engineerQ.refetch;
  // Шапка для всех ролей — название объекта без кода.
  const title = viewerIsContractor
    ? contractorQ.data?.data.project_name ?? 'Смета'
    : engineerQ.data?.data?.project_name ?? 'Смета';

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
          activeKey={activeTab}
          onChange={onTabChange}
          // Кнопка живёт в строке вкладок и только на «Смете»: ВОР — про работы сметы, а на
          // «Материалах» и «Заявках» она была бы не к месту. Подрядчику ВОР закрыт.
          tabBarExtraContent={
            !viewerIsContractor && activeTab === 'smeta'
              ? {
                  right: (
                    <Button icon={<FileExcelOutlined />} onClick={() => setVorListOpen(true)}>
                      ВОР
                    </Button>
                  ),
                }
              : undefined
          }
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
                  costTypeCiphers={costTypeCiphers}
                  zones={zones}
                  onOpenVorRegistry={() => setVorListOpen(true)}
                  contractFilter={contractFilter}
                  onClearContractFilter={() => setContractFilter(null)}
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
                  costTypeCiphers={costTypeCiphers}
                  zones={zones}
                  zoneIndex={zoneIndex}
                />
              ),
            },
            {
              key: 'requests',
              label: 'Заявки',
              children: (
                <ContractorsRequestsTab
                  estimateId={estimateId}
                  viewerIsContractor={viewerIsContractor}
                  active={activeTab === 'requests'}
                />
              ),
            },
          ]}
        />
      )}
      {/* Один реестр ВОР на весь раздел: и кнопка «ВОР», и метка «В» в строке сметы открывают его. */}
      {!viewerIsContractor && (
        <VorObjectListModal
          open={vorListOpen}
          onClose={() => setVorListOpen(false)}
          estimateId={estimateId}
          onChanged={() => refetch()}
          onShowContract={showContract}
        />
      )}
    </Card>
  );
}
