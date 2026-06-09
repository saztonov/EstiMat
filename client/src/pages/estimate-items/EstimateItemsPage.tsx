import { useState } from 'react';
import { Table, Select, Input, Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../services/api';
import { formatMoney } from '../estimates/components/types';
import type { EstimateItemRow, EstimateItemsResponse, RegistryMaterial } from './types';

const { Title } = Typography;

interface Project { id: string; code: string; name: string }
interface Named { id: string; name: string }
interface CostType { id: string; name: string; category_id: string }
interface Organization { id: string; name: string; type?: string }

export function EstimateItemsPage() {
  const navigate = useNavigate();

  const [projectId, setProjectId] = useState<string>();
  const [costCategoryId, setCostCategoryId] = useState<string>();
  const [costTypeId, setCostTypeId] = useState<string>();
  const [contractorId, setContractorId] = useState<string>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ data: Project[] }>('/projects'),
  });
  const { data: categories } = useQuery({
    queryKey: ['rate-categories'],
    queryFn: () => api.get<{ data: Named[] }>('/rates/categories'),
  });
  const { data: types } = useQuery({
    queryKey: ['rate-types', costCategoryId],
    queryFn: () =>
      api.get<{ data: CostType[] }>(
        costCategoryId ? `/rates/types?categoryId=${costCategoryId}` : '/rates/types',
      ),
  });
  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Organization[] }>('/organizations'),
  });

  const filters = { projectId, costCategoryId, costTypeId, contractorId, search, page, pageSize };

  const { data, isFetching } = useQuery({
    queryKey: ['estimate-items', filters],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (projectId) qs.set('projectId', projectId);
      if (costCategoryId) qs.set('costCategoryId', costCategoryId);
      if (costTypeId) qs.set('costTypeId', costTypeId);
      if (contractorId) qs.set('contractorId', contractorId);
      if (search.trim()) qs.set('search', search.trim());
      qs.set('page', String(page));
      qs.set('pageSize', String(pageSize));
      return api.get<EstimateItemsResponse>(`/estimate-items?${qs.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const columns: ColumnsType<EstimateItemRow> = [
    {
      title: 'Объект',
      width: 220,
      render: (_v, r) =>
        r.project_code ? `${r.project_code} · ${r.project_name ?? ''}` : (r.project_name ?? '—'),
    },
    { title: 'Категория', dataIndex: 'cost_category_name', width: 180, render: (v: string) => v || '—' },
    { title: 'Вид затрат', dataIndex: 'cost_type_name', width: 180, render: (v: string) => v || '—' },
    {
      title: 'Подрядчик',
      dataIndex: 'contractor_name',
      width: 180,
      render: (v: string) => (v ? <Tag color="purple">{v}</Tag> : '—'),
    },
    { title: 'Наименование работы', dataIndex: 'description' },
    { title: 'Ед. изм.', dataIndex: 'unit', width: 90, align: 'center' },
    {
      title: 'Кол-во',
      dataIndex: 'quantity',
      width: 100,
      align: 'right',
      render: (v: string) => Number(v).toLocaleString('ru-RU'),
    },
    { title: 'Цена', dataIndex: 'unit_price', width: 130, align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: 'Сумма',
      dataIndex: 'total',
      width: 140,
      align: 'right',
      render: (v: string) => <strong>{formatMoney(v)}</strong>,
    },
  ];

  const materialColumns: ColumnsType<RegistryMaterial> = [
    { title: 'Материал', dataIndex: 'description' },
    { title: 'Ед. изм.', dataIndex: 'unit', width: 90, align: 'center' },
    { title: 'Кол-во', dataIndex: 'quantity', width: 100, align: 'right', render: (v: string) => Number(v).toLocaleString('ru-RU') },
    { title: 'Цена', dataIndex: 'unit_price', width: 130, align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Сумма', dataIndex: 'total', width: 140, align: 'right', render: (v: string) => formatMoney(v) },
  ];

  return (
    <div className="table-page-wrapper">
      <Title level={4} style={{ marginTop: 0 }}>Реестр строк смет</Title>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Объект"
          style={{ width: 240 }}
          value={projectId}
          onChange={(v) => { setProjectId(v); setPage(1); }}
          options={projects?.data.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Категория затрат"
          style={{ width: 220 }}
          value={costCategoryId}
          onChange={(v) => { setCostCategoryId(v); setCostTypeId(undefined); setPage(1); }}
          options={categories?.data.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Вид затрат"
          style={{ width: 220 }}
          value={costTypeId}
          onChange={(v) => { setCostTypeId(v); setPage(1); }}
          options={types?.data.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Подрядчик"
          style={{ width: 220 }}
          value={contractorId}
          onChange={(v) => { setContractorId(v); setPage(1); }}
          options={orgs?.data
            .filter((o) => o.type === 'subcontractor' || o.type === 'general_contractor')
            .map((o) => ({ value: o.id, label: o.name }))}
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Поиск по наименованию"
          style={{ width: 260 }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </Space>

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={data?.data ?? []}
        loading={isFetching}
        scroll={{ y: 'flex' }}
        onRow={(r) => ({ onClick: () => navigate(`/estimates/${r.estimate_id}`) })}
        style={{ cursor: 'pointer' }}
        expandable={{
          rowExpandable: (r) => (r.materials?.length ?? 0) > 0,
          expandedRowRender: (r) => (
            <Table
              rowKey="id"
              size="small"
              columns={materialColumns}
              dataSource={r.materials}
              pagination={false}
              style={{ marginLeft: 24 }}
            />
          ),
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.pagination.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (t) => `Всего: ${t}`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </div>
  );
}
