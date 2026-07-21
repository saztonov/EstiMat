import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button, Empty, Input, Space, Spin, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import type { EstimateDetail } from './components/types';
import { formatMoney } from './components/types';
import {
  buildMaterialGroups,
  type AggregatedMaterial,
  type MaterialGroup,
  type MaterialOccurrence,
} from './materials/aggregateMaterials';

const fmtQty = (v: number) => Number(v).toLocaleString('ru-RU');

// Ячейка названия материала с агрегированными бейджами (как во вложенной
// таблице материалов сметы). На этом этапе бейджи не кликабельны.
function nameCell(name: string, hasAi: boolean, hasNeedsReview: boolean, hasSuggested: boolean) {
  if (!hasAi && !hasNeedsReview && !hasSuggested) return name;
  return (
    <div className="estimat-review-cell">
      <span className="estimat-review-name">{name}</span>
      <span className="estimat-review-tags">
        {hasSuggested && <Tag color="orange">предложение</Tag>}
        {hasAi && <Tag color="blue">ИИ</Tag>}
        {hasNeedsReview && <Tag color="orange">не согласовано</Tag>}
      </span>
    </div>
  );
}

// Разбивка свёрнутой строки по работам.
const occurrenceColumns: ColumnsType<MaterialOccurrence> = [
  {
    title: 'Работа',
    dataIndex: 'workName',
    render: (v: string, r) => (
      <div className="estimat-review-cell">
        <span className="estimat-review-name">{v}</span>
        <span className="estimat-review-tags">
          {r.status === 'suggested' && <Tag color="orange">предложение</Tag>}
          {r.source === 'ai' && <Tag color="blue">ИИ</Tag>}
          {r.needsReview && <Tag color="orange">не согласовано</Tag>}
        </span>
      </div>
    ),
  },
  { title: 'Ед.', dataIndex: 'unit', width: 64, align: 'center' },
  {
    title: 'Кол-во',
    dataIndex: 'quantity',
    width: 90,
    align: 'center',
    render: (v: number) => <span className="estimat-qty-chip">{fmtQty(v)}</span>,
  },
  { title: 'Цена', dataIndex: 'unitPrice', width: 110, align: 'right', render: (v: number) => formatMoney(v) },
  { title: 'Сумма', dataIndex: 'total', width: 120, align: 'right', render: (v: number) => formatMoney(v) },
];

const materialColumns: ColumnsType<AggregatedMaterial> = [
  { title: '№', width: 44, align: 'center', render: (_v, _r, i) => i + 1 },
  {
    title: 'Материал',
    dataIndex: 'name',
    render: (v: string, r) => nameCell(v, r.hasAi, r.hasNeedsReview, r.hasSuggested),
  },
  { title: 'Ед.', dataIndex: 'unit', width: 64, align: 'center' },
  {
    title: 'Кол-во по смете',
    dataIndex: 'quantity',
    width: 130,
    align: 'center',
    render: (v: number) => <span className="estimat-qty-chip">{fmtQty(v)}</span>,
  },
  {
    title: 'Цена',
    dataIndex: 'unitPrice',
    width: 110,
    align: 'right',
    render: (v: number) => formatMoney(v),
  },
  {
    title: 'Сумма по смете',
    dataIndex: 'total',
    width: 130,
    align: 'right',
    render: (v: number) => <strong>{formatMoney(v)}</strong>,
  },
];

// Блок одного вида работ: заголовок с подрядчиком + таблица свёрнутых материалов.
function MaterialGroupBlock({ group }: { group: MaterialGroup }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          background: 'var(--est-bg-group)',
          border: '1px solid var(--est-border-group)',
          borderRadius: 8,
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 13 }}>{group.costTypeName ?? 'Без вида работ'}</strong>
        {group.costCategoryName && (
          <span style={{ color: 'var(--est-text-tertiary)', fontSize: 12 }}>· {group.costCategoryName}</span>
        )}
        {group.contractorName ? (
          <Tag color="geekblue" style={{ marginInlineStart: 4 }}>
            {group.contractorName}
          </Tag>
        ) : (
          <span style={{ color: 'var(--est-text-quaternary)', fontSize: 12 }}>· подрядчик не назначен</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--est-primary)', fontWeight: 600 }}>{formatMoney(group.total)}</span>
      </div>

      <Table<AggregatedMaterial>
        rowKey="key"
        size="small"
        className="estimat-compact"
        columns={materialColumns}
        dataSource={group.materials}
        pagination={false}
        scroll={{ x: 680 }}
        expandable={{
          expandedRowRender: (r) => (
            <Table<MaterialOccurrence>
              rowKey="materialRowId"
              size="small"
              className="estimat-compact"
              columns={occurrenceColumns}
              dataSource={r.occurrences}
              pagination={false}
              scroll={{ x: 600 }}
            />
          ),
          rowExpandable: (r) => r.occurrences.length > 0,
        }}
      />
    </div>
  );
}

// Свод материалов сметы. Открывается кнопкой «Материалы» из тулбара сметы.
export function EstimateMaterialsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [onlyAi, setOnlyAi] = useState(false);
  const [onlySuggested, setOnlySuggested] = useState(false);

  // Тот же запрос, что и страница сметы — попадание в кэш ['estimate', id].
  const { data, isLoading } = useQuery({
    queryKey: ['estimate', id],
    queryFn: () => api.get<{ data: EstimateDetail }>(`/estimates/${id}`),
    enabled: !!id,
    refetchOnWindowFocus: true,
  });

  const estimate = data?.data;

  const allGroups = useMemo(
    () => (estimate ? buildMaterialGroups(estimate.items, estimate.contractors) : []),
    [estimate],
  );

  // Метрики шапки — по всей смете (без учёта фильтров).
  const metrics = useMemo(() => {
    let total = 0;
    let rows = 0;
    let needsReview = 0;
    let ai = 0;
    for (const g of allGroups) {
      total += g.total;
      for (const m of g.materials) {
        rows += 1;
        if (m.hasNeedsReview) needsReview += 1;
        if (m.hasAi) ai += 1;
      }
    }
    return { total, rows, needsReview, ai };
  }, [allGroups]);

  // Применение фильтров к свёрнутым строкам; пустые блоки убираем.
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allGroups
      .map((g) => ({
        ...g,
        materials: g.materials.filter(
          (m) =>
            (!q || m.name.toLowerCase().includes(q)) &&
            (!onlyNeedsReview || m.hasNeedsReview) &&
            (!onlyAi || m.hasAi) &&
            (!onlySuggested || m.hasSuggested),
        ),
      }))
      .filter((g) => g.materials.length > 0);
  }, [allGroups, search, onlyNeedsReview, onlyAi, onlySuggested]);

  if (isLoading) return <Spin size="large" />;
  if (!estimate) return <div>Смета не найдена</div>;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Шапка с метриками */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          rowGap: 4,
          padding: '8px 12px',
          background: 'var(--est-bg-container)',
          borderBottom: '1px solid var(--est-border)',
        }}
      >
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/estimates/${id}`)}>
          К смете
        </Button>
        <Typography.Text strong style={{ fontSize: 15, whiteSpace: 'nowrap' }}>
          Материалы
        </Typography.Text>
        <Typography.Text type="secondary" ellipsis style={{ fontSize: 12.5, maxWidth: 'min(320px, 50vw)' }}>
          {estimate.project_code} · {estimate.project_name}
        </Typography.Text>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--est-primary)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {formatMoney(metrics.total)}
        </span>
        <Typography.Text type="secondary" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
          Позиций: {metrics.rows} · Не согласовано: {metrics.needsReview} · ИИ: {metrics.ai}
        </Typography.Text>
      </div>

      {/* Фильтры */}
      <div style={{ flexShrink: 0, padding: '8px 12px', background: 'var(--est-bg-subtle)', borderBottom: '1px solid var(--est-border)' }}>
        <Space wrap className="estimat-toolbar">
          <Input.Search
            allowClear
            placeholder="Поиск по материалу"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 280 }}
          />
          <Tooltip title="Только несогласованные позиции">
            <Space size={6}>
              <Switch size="small" checked={onlyNeedsReview} onChange={setOnlyNeedsReview} />
              <span style={{ fontSize: 13, color: 'var(--est-text-secondary)' }}>Не согласованные</span>
            </Space>
          </Tooltip>
          <Tooltip title="Только добавленные ИИ">
            <Space size={6}>
              <Switch size="small" checked={onlyAi} onChange={setOnlyAi} />
              <span style={{ fontSize: 13, color: 'var(--est-text-secondary)' }}>ИИ</span>
            </Space>
          </Tooltip>
          <Tooltip title="Только предложенные (типовые) материалы">
            <Space size={6}>
              <Switch size="small" checked={onlySuggested} onChange={setOnlySuggested} />
              <span style={{ fontSize: 13, color: 'var(--est-text-secondary)' }}>Предложения</span>
            </Space>
          </Tooltip>
        </Space>
      </div>

      {/* Тело со скроллом */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 8px', background: 'var(--est-bg-layout)' }}>
        {allGroups.length === 0 ? (
          <Empty description="В смете пока нет материалов" style={{ padding: '40px 0' }} />
        ) : filteredGroups.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ничего не найдено по отбору" style={{ padding: '40px 0' }} />
        ) : (
          filteredGroups.map((g) => <MaterialGroupBlock key={g.costTypeId ?? '__none__'} group={g} />)
        )}
      </div>
    </div>
  );
}
