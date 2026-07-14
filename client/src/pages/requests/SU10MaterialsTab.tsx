import { useEffect, useMemo, useState } from 'react';
import { Select, Table, Button, Space, Empty, Tag, Tooltip } from 'antd';
import { ShoppingCartOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MATERIAL_REQUEST_TYPES, MATERIAL_REQUEST_TYPE_LABELS } from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { round4 } from './requestConstants';
import { SupplierLotFormModal } from './SupplierLotFormModal';
import type { Su10MaterialRow, MaterialsFacets, CategoryResponsibles } from './types';

const EPS = 1e-6;

/**
 * Вкладка «Материалы» (снабжение): свод материалов заявок (все виды) с фильтрами и серверной
 * пагинацией. Заказ поставщику (лот) формируется только из позиций СУ-10 и только по категориям,
 * за которые пользователь отвечает (справочник «Закупки»), либо админом. Объект берётся из
 * выбранных строк — лот всегда в рамках одного объекта.
 */
export function SU10MaterialsTab() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [projectId, setProjectId] = useState<string | undefined>();
  const [contractorId, setContractorId] = useState<string | undefined>();
  const [requestType, setRequestType] = useState<string | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  // Зоны ответственности (справочник «Закупки») — тот же кэш, что у панели «Закупки».
  const responsiblesQ = useQuery({
    queryKey: ['procurement-responsibles'],
    queryFn: () => api.get<{ data: CategoryResponsibles[] }>('/procurement/responsibles'),
  });
  const responsiblesReady = responsiblesQ.isSuccess;

  const { myCategoryIds, categoriesWithResp, respByCategory } = useMemo(() => {
    const mine = new Set<string>();
    const withResp = new Set<string>();
    const byCat = new Map<string, string[]>();
    for (const c of responsiblesQ.data?.data ?? []) {
      if (c.responsibles.length > 0) withResp.add(c.id);
      byCat.set(c.id, c.responsibles.map((r) => r.full_name));
      if (user && c.responsibles.some((r) => r.id === user.id)) mine.add(c.id);
    }
    return { myCategoryIds: mine, categoriesWithResp: withResp, respByCategory: byCat };
  }, [responsiblesQ.data, user]);

  const materialsQ = useQuery({
    queryKey: ['su10-materials', projectId ?? '', contractorId ?? '', requestType ?? '', categoryId ?? '', limit, offset],
    queryFn: () => {
      const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (projectId) p.set('projectId', projectId);
      if (contractorId) p.set('contractorId', contractorId);
      if (requestType) p.set('requestType', requestType);
      if (categoryId) p.set('categoryId', categoryId);
      return api.get<{ data: Su10MaterialRow[]; meta: { total: number; facets: MaterialsFacets } }>(
        `/supplier-orders/materials?${p.toString()}`,
      );
    },
    refetchOnWindowFocus: true,
  });

  const rows = materialsQ.data?.data ?? [];
  const total = materialsQ.data?.meta.total ?? 0;
  const facets = materialsQ.data?.meta.facets;

  // Единый источник истины доступности строки: чекбокс, «Заказ поставщику» и payload.
  // Fail closed: пока справочник ответственных не загружен — выбор недоступен.
  function isEligible(r: Su10MaterialRow): boolean {
    if (!responsiblesReady) return false;
    if (r.request_type !== 'su10') return false;
    if (r.remaining == null || r.remaining <= EPS) return false;
    if (!r.project_id) return false; // лот всегда в рамках объекта
    if (isAdmin) return true;
    if (!r.category_id) return false; // без категории — только админ
    return myCategoryIds.has(r.category_id) || !categoriesWithResp.has(r.category_id);
  }

  // Сброс выбора при смене фильтров/страницы/размера.
  function resetSelection() { setSelected(new Set()); }
  function changeFilter<T>(setter: (v: T) => void, v: T) { setter(v); setOffset(0); resetSelection(); }

  // После обновления данных — снять с выбора строки, ставшие недоступными (в пределах страницы).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => {
        const r = rows.find((x) => x.request_item_id === id);
        return r && isEligible(r);
      }));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, responsiblesReady, myCategoryIds]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.request_item_id)), [rows, selected]);
  const lockedProjectId = selectedRows[0]?.project_id ?? null;

  const columns: ColumnsType<Su10MaterialRow> = [
    {
      title: 'Материал', dataIndex: 'material_name', key: 'name',
      render: (v: string, r) => (
        <Space size={4}>
          {v}
          {r.request_type === 'su10' && r.remaining != null && r.remaining <= EPS && <Tag color="default">в лотах</Tag>}
        </Space>
      ),
    },
    {
      title: 'Объект', dataIndex: 'project_name', key: 'project', width: 200,
      render: (v: string | null, r) => (v ? `${r.project_code ? `${r.project_code} · ` : ''}${v}` : '—'),
    },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 64 },
    { title: 'Категория', dataIndex: 'category_name', key: 'cat', width: 150, render: (v: string | null) => v ?? '—' },
    { title: 'Вид работ', dataIndex: 'cost_type_name', key: 'ct', width: 150, render: (v: string | null) => v ?? '—' },
    {
      title: 'Вид заявки', dataIndex: 'request_type', key: 'rtype', width: 150,
      render: (v: string) => <Tag>{MATERIAL_REQUEST_TYPE_LABELS[v as keyof typeof MATERIAL_REQUEST_TYPE_LABELS] ?? v}</Tag>,
    },
    { title: 'Подрядчик', dataIndex: 'contractor_name', key: 'contractor', width: 160, render: (v: string | null) => v ?? '—' },
    {
      title: 'Заявка', dataIndex: 'request_no', key: 'req', width: 90,
      render: (v: number | null, r) => (v ? <Link to={`/requests/${r.request_id}`}>№ {v}</Link> : '—'),
    },
    {
      title: 'Ответственный', key: 'resp', width: 170,
      render: (_, r) => {
        const names = r.category_id ? respByCategory.get(r.category_id) ?? [] : [];
        return names.length ? names.join(', ') : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    },
    { title: 'Запрошено', dataIndex: 'requested', key: 'requested', width: 100, align: 'right', render: (v) => round4(v) },
    {
      title: 'В лотах СУ-10', dataIndex: 'ordered', key: 'ordered', width: 110, align: 'right',
      render: (v: number | null) => (v == null ? <span style={{ color: '#bfbfbf' }}>—</span> : Number(v) > 0 ? round4(v) : <span style={{ color: '#bfbfbf' }}>0</span>),
    },
    {
      title: 'Осталось распределить', dataIndex: 'remaining', key: 'remaining', width: 130, align: 'right',
      render: (v: number | null) =>
        v == null ? <span style={{ color: '#bfbfbf' }}>не применяется</span>
          : <strong style={{ color: v > EPS ? '#1677ff' : '#bfbfbf' }}>{round4(v)}</strong>,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ flexShrink: 0, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          allowClear showSearch placeholder="Все объекты" style={{ width: 260 }}
          value={projectId} onChange={(v) => changeFilter(setProjectId, v)}
          optionFilterProp="label"
          options={(facets?.projects ?? []).map((p) => ({ value: p.id, label: `${p.code ? `${p.code} · ` : ''}${p.name ?? ''}` }))}
        />
        <Select
          allowClear placeholder="Все виды заявок" style={{ width: 190 }}
          value={requestType} onChange={(v) => changeFilter(setRequestType, v)}
          options={MATERIAL_REQUEST_TYPES.map((t) => ({ value: t, label: MATERIAL_REQUEST_TYPE_LABELS[t] }))}
        />
        <Select
          allowClear showSearch placeholder="Все подрядчики" style={{ width: 200 }}
          value={contractorId} onChange={(v) => changeFilter(setContractorId, v)}
          optionFilterProp="label"
          options={(facets?.contractors ?? []).map((c) => ({ value: c.id, label: c.name ?? '—' }))}
        />
        <Select
          allowClear showSearch placeholder="Все категории" style={{ width: 200 }}
          value={categoryId} onChange={(v) => changeFilter(setCategoryId, v)}
          optionFilterProp="label"
          options={(facets?.categories ?? []).map((c) => ({ value: c.id, label: c.name ?? '—' }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => materialsQ.refetch()} loading={materialsQ.isFetching}>Обновить</Button>
        <div style={{ flex: 1 }} />
        <Tooltip title={!lockedProjectId && selected.size > 0 ? 'Материалы без объекта — лот не сформировать' : ''}>
          <Button
            type="primary"
            icon={<ShoppingCartOutlined />}
            disabled={selectedRows.length === 0 || !lockedProjectId}
            onClick={() => setModalOpen(true)}
          >
            Заказ поставщику{selectedRows.length > 0 ? ` (${selectedRows.length})` : ''}
          </Button>
        </Tooltip>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table<Su10MaterialRow>
          rowKey="request_item_id"
          size="small"
          loading={materialsQ.isLoading}
          dataSource={rows}
          columns={columns}
          locale={{ emptyText: <Empty description="Материалов по заявкам нет" /> }}
          rowSelection={{
            type: 'checkbox',
            selectedRowKeys: [...selected],
            onChange: (keys) => setSelected(new Set(keys.map(String))),
            getCheckboxProps: (r) => ({
              disabled: !isEligible(r) || (selected.size > 0 && !!lockedProjectId && r.project_id !== lockedProjectId),
            }),
          }}
          pagination={{
            ...DEFAULT_PAGINATION,
            current: Math.floor(offset / limit) + 1,
            pageSize: limit,
            total,
            onChange: (page, size) => {
              if (size !== limit) { setLimit(size); setOffset(0); } else { setOffset((page - 1) * size); }
              resetSelection();
            },
          }}
          scroll={{ x: 1500 }}
        />
      </div>

      {modalOpen && lockedProjectId && (
        <SupplierLotFormModal
          open
          projectId={lockedProjectId}
          rows={selectedRows}
          onClose={() => setModalOpen(false)}
          onDone={() => { setModalOpen(false); resetSelection(); materialsQ.refetch(); }}
        />
      )}
    </div>
  );
}
