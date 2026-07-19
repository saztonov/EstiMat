import { useEffect, useMemo, useState } from 'react';
import { Select, Table, Button, Space, Empty, Tag, Tooltip, Badge, Alert, Dropdown, App } from 'antd';
import { ShoppingCartOutlined, ReloadOutlined, FilterOutlined, DownOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MATERIAL_REQUEST_TYPES, MATERIAL_REQUEST_TYPE_LABELS, MATERIAL_REQUEST_TYPE_SHORT_LABELS } from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { usePersistedState } from '../../hooks/usePersistedState';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { applyColumnPrefs } from '../../lib/columnPrefs';
import { applyColumnFilters, hasActiveColumnFilters, type ColumnFilters, type ColumnFilterSpec } from '../../lib/columnFilters';
import { headerFilterCol } from '../../lib/tableHeaderFilters';
import {
  groupRows, levelsFromOrder, isGroupRow, collectGroupKeys, applyGroupSpan, GROUP_KEY_PREFIX,
  type GroupLevel, type GroupRow, type GroupNode,
} from '../../lib/tableGrouping';
import { ColumnSettingsButton } from '../../components/table/ColumnSettingsButton';
import { materialsColumnsStore, MATERIALS_COLUMN_DEFS } from './columns/materialsColumns';
import { ResponsibleSelect } from './ResponsibleSelect';
import { round4, requestNumber } from './requestConstants';
import { SupplierOrderModal } from './SupplierOrderModal';
import { TenderCreateModal } from './TenderCreateModal';
import { RequestDetailModal } from './RequestDetailModal';
import type { Su10MaterialRow, MaterialsFacets, CategoryResponsibles, AssignableUser } from './types';

const EPS = 1e-6;
const KEY = 'estimat:requests-materials:';
const fmtRuDate = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };

type MaterialTableRow = GroupRow<Su10MaterialRow>;
const GROUPABLE = new Set(MATERIALS_COLUMN_DEFS.filter((d) => d.groupable).map((d) => d.key));

/**
 * Вкладка «Материалы» (снабжение): свод материалов заявок с настраиваемыми столбцами, отборами и
 * группировкой прямо в заголовках. Дерево строится по отмеченным столбцам в порядке настроек.
 * При активном отборе или группировке грузится весь набор (all=1, потолок 5000, meta.truncated) —
 * тогда отборы и дерево считаются на клиенте. Ответственного за строку можно назначить конкретного
 * (override), иначе показываются все по категории вида работ. Заказ поставщику формируется из su10.
 */
export function SU10MaterialsTab() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const canAssign = user?.role === 'admin' || user?.role === 'engineer' || user?.role === 'manager';

  const [projectId, setProjectId] = usePersistedState<string | undefined>(`${KEY}projectId`, undefined);
  const [contractorId, setContractorId] = usePersistedState<string | undefined>(`${KEY}contractorId`, undefined);
  const [requestType, setRequestType] = usePersistedState<string | undefined>(`${KEY}requestType`, 'su10');
  const [categoryId, setCategoryId] = usePersistedState<string | undefined>(`${KEY}categoryId`, undefined);
  const [filtersOpen, setFiltersOpen] = usePersistedState<boolean>(`${KEY}filtersOpen`, false);
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [colFilters, setColFilters] = useState<ColumnFilters>({});
  const [peek, setPeek] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<'order' | 'tender' | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);

  // Настройки столбцов (порядок/видимость/уровни дерева) — в localStorage.
  const order = materialsColumnsStore.useStore((s) => s.order);
  const hidden = materialsColumnsStore.useStore((s) => s.hidden);
  const groupBy = materialsColumnsStore.useStore((s) => s.groupBy);
  const toggleGroupBy = materialsColumnsStore.useStore((s) => s.toggleGroupBy);
  const prefs = materialsColumnsStore.resolve(order, hidden);

  // Зоны ответственности (справочник «Закупки») + кандидаты в ответственные.
  const responsiblesQ = useQuery({
    queryKey: ['procurement-responsibles'],
    queryFn: () => api.get<{ data: CategoryResponsibles[] }>('/procurement/responsibles'),
  });
  const assignableQ = useQuery({
    queryKey: ['procurement-assignable-users'],
    queryFn: () => api.get<{ data: AssignableUser[] }>('/procurement/assignable-users'),
    enabled: canAssign,
  });
  const assignable = assignableQ.data?.data ?? [];
  const responsiblesReady = responsiblesQ.isSuccess;

  const { myCategoryIds, categoriesWithResp, respByCategory, respIdsByCategory } = useMemo(() => {
    const mine = new Set<string>();
    const withResp = new Set<string>();
    const byCat = new Map<string, string[]>();
    const idsByCat = new Map<string, string[]>();
    for (const c of responsiblesQ.data?.data ?? []) {
      if (c.responsibles.length > 0) withResp.add(c.id);
      byCat.set(c.id, c.responsibles.map((r) => r.full_name));
      idsByCat.set(c.id, c.responsibles.map((r) => r.id));
      if (user && c.responsibles.some((r) => r.id === user.id)) mine.add(c.id);
    }
    return { myCategoryIds: mine, categoriesWithResp: withResp, respByCategory: byCat, respIdsByCategory: idsByCat };
  }, [responsiblesQ.data, user]);

  // Эффективный ответственный строки (для отбора и группировки по столбцу): override или все по категории.
  const respText = (r: Su10MaterialRow): string =>
    r.assigned_responsible_name ?? (r.category_id ? (respByCategory.get(r.category_id) ?? []).join(', ') : '');

  // Уровни дерева — из отмеченных «Группировать» видимых столбцов в порядке настроек.
  const levelMap = useMemo<Record<string, GroupLevel<Su10MaterialRow> | undefined>>(() => ({
    project: {
      key: 'project', idOf: (r) => r.project_id ?? 'none',
      labelOf: (r) => (r.project_name ? `${r.project_code ? `${r.project_code} · ` : ''}${r.project_name}` : '— Без объекта'),
      cmp: (a, b) => (a.project_name || '').localeCompare(b.project_name || '', 'ru'),
    },
    contractor: {
      key: 'contractor', idOf: (r) => r.contractor_id ?? 'none',
      labelOf: (r) => r.contractor_name || '— Без подрядчика',
      cmp: (a, b) => (a.contractor_name || '').localeCompare(b.contractor_name || '', 'ru'),
    },
    resp: {
      key: 'resp', idOf: (r) => r.assigned_responsible_id ?? (r.category_id ? `cat:${r.category_id}` : 'none'),
      labelOf: (r) => respText(r) || '— не назначены',
    },
    req: {
      key: 'req', idOf: (r) => r.request_id,
      labelOf: (r) => `№ ${r.request_no ?? '—'} · ${r.project_code || r.project_name || 'без объекта'}`,
      cmp: (a, b) => (a.project_name || '').localeCompare(b.project_name || '', 'ru') || (a.request_no ?? 0) - (b.request_no ?? 0),
    },
    category: {
      key: 'category', idOf: (r) => r.category_id ?? 'none',
      labelOf: (r) => r.category_name || '— Без категории',
      cmp: (a, b) => (a.category_sort ?? 9999) - (b.category_sort ?? 9999) || (a.category_name || '').localeCompare(b.category_name || '', 'ru'),
    },
  }), [respByCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const levels = levelsFromOrder(prefs.order, groupBy, prefs.hidden, levelMap);
  const treeMode = levels.length > 0;
  const anyColFilter = hasActiveColumnFilters(colFilters, prefs.hidden);
  // Отбор/дерево считаются на клиенте по всему набору → грузим all=1. peek — открыт дропдаун
  // отбора (нужны варианты multi со всего набора).
  const needFull = treeMode || anyColFilter || peek;

  const materialsQ = useQuery({
    queryKey: [
      'su10-materials', projectId ?? '', contractorId ?? '', requestType ?? '', categoryId ?? '',
      needFull ? 'all' : limit, needFull ? 0 : offset,
    ],
    queryFn: () => {
      const p = new URLSearchParams();
      if (needFull) p.set('all', '1');
      else { p.set('limit', String(limit)); p.set('offset', String(offset)); }
      if (projectId) p.set('projectId', projectId);
      if (contractorId) p.set('contractorId', contractorId);
      if (requestType) p.set('requestType', requestType);
      if (categoryId) p.set('categoryId', categoryId);
      return api.get<{ data: Su10MaterialRow[]; meta: { total: number; truncated?: boolean; facets: MaterialsFacets } }>(
        `/supplier-orders/materials?${p.toString()}`,
      );
    },
    refetchOnWindowFocus: true,
  });

  const rows = materialsQ.data?.data ?? [];
  const total = materialsQ.data?.meta.total ?? 0;
  const truncated = (materialsQ.data?.meta.truncated ?? false) && needFull;
  const facets = materialsQ.data?.meta.facets;

  useEffect(() => {
    if (!materialsQ.isSuccess || !facets) return;
    if (projectId && !facets.projects.some((p) => p.id === projectId)) setProjectId(undefined);
    if (contractorId && !facets.contractors.some((c) => c.id === contractorId)) setContractorId(undefined);
    if (categoryId && !facets.categories.some((c) => c.id === categoryId)) setCategoryId(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialsQ.isSuccess, facets]);

  function isEligible(r: Su10MaterialRow): boolean {
    if (!responsiblesReady) return false;
    if (r.request_type !== 'su10') return false;
    if (r.remaining == null || r.remaining <= EPS) return false;
    if (!r.project_id) return false;
    if (isAdmin) return true;
    if (!r.category_id) return false;
    return myCategoryIds.has(r.category_id) || !categoriesWithResp.has(r.category_id);
  }

  function resetSelection() { setSelected(new Set()); }
  function changeFilter<T>(setter: (v: T) => void, v: T) { setter(v); setOffset(0); resetSelection(); }
  function changeColFilter(key: string, v: ColumnFilters[string]) {
    setColFilters((f) => ({ ...f, [key]: v })); setOffset(0); resetSelection();
  }
  function changeGroup(key: string, on: boolean) { toggleGroupBy(key, on); setOffset(0); resetSelection(); }

  // Клиентский отбор строк (по всему набору) — до группировки.
  const filterSpecs = useMemo<Record<
    'name' | 'project' | 'contractor' | 'resp' | 'req' | 'unit' | 'delivery' | 'requested' | 'remaining' | 'category',
    ColumnFilterSpec<Su10MaterialRow>
  >>(() => ({
    name: { kind: 'text', getText: (r) => r.material_name },
    project: { kind: 'multi', getText: (r) => r.project_name },
    contractor: { kind: 'multi', getText: (r) => r.contractor_name },
    resp: { kind: 'text', getText: respText },
    req: { kind: 'text', getText: (r) => requestNumber(r.project_code, r.request_no ?? 0) },
    unit: { kind: 'multi', getText: (r) => r.unit },
    delivery: { kind: 'dateRange', getDate: (r) => r.delivery_date },
    requested: { kind: 'numRange', getNum: (r) => r.requested },
    remaining: { kind: 'numRange', getNum: (r) => r.remaining },
    category: { kind: 'multi', getText: (r) => r.category_name },
  }), [respByCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(
    () => applyColumnFilters(rows, colFilters, filterSpecs, prefs.hidden),
    [rows, colFilters, filterSpecs, prefs.hidden],
  );

  const tableData = useMemo<MaterialTableRow[]>(
    () => (treeMode
      ? groupRows(filtered, levels, (items) => ({
          requested: items.reduce((s, x) => s + Number(x.requested), 0),
          remaining: items.reduce((s, x) => s + (x.remaining ?? 0), 0),
        }))
      : filtered),
    [filtered, treeMode, levels],
  );

  // Сигнатура только по ВЕРХНИМ группам — иначе изменения внутри групп (перетекание позиций
  // после назначения ответственного) сбрасывали бы ручное сворачивание подгрупп.
  const groupSignature = treeMode ? tableData.filter(isGroupRow).map((g) => g.key).join('|') : '';
  useEffect(() => {
    setExpandedKeys(treeMode ? collectGroupKeys(tableData) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSignature]);

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
  const hiddenActiveCount = (requestType ? 1 : 0) + (categoryId ? 1 : 0);

  // Назначение ответственного.
  const assignMut = useMutation({
    mutationFn: (v: { id: string; userId: string | null }) =>
      api.patch(`/supplier-orders/materials/${v.id}/responsible`, { userId: v.userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['su10-materials'] }),
    onError: (e: Error) => message.error(e.message),
  });
  const bulkAssignMut = useMutation({
    mutationFn: (v: { ids: string[]; userId: string | null }) =>
      api.patch('/supplier-orders/materials/responsible', { requestItemIds: v.ids, userId: v.userId }),
    onSuccess: (_d, v) => { message.success(`Ответственный назначен: ${v.ids.length} поз.`); qc.invalidateQueries({ queryKey: ['su10-materials'] }); },
    onError: (e: Error) => message.error(e.message),
  });

  function assignGroup(node: GroupNode<Su10MaterialRow>, userId: string | null) {
    const ids = node.items.map((i) => i.request_item_id);
    modal.confirm({
      title: userId ? 'Назначить ответственного группе' : 'Сбросить ответственного у группы',
      content: `${userId ? 'Назначить выбранного ответственного' : 'Убрать назначение'} для ${ids.length} позиций «${node.label}»?`,
      okText: userId ? 'Назначить' : 'Сбросить',
      cancelText: 'Отмена',
      onOk: () => bulkAssignMut.mutateAsync({ ids, userId }),
    });
  }

  // Колонки (рендер листа; групповые строки перекрываются applyGroupSpan).
  const hf = (key: string, spec: ColumnFilterSpec<Su10MaterialRow>) => ({
    ...headerFilterCol<Su10MaterialRow>({
      spec, value: colFilters[key], rows, onChange: (v) => changeColFilter(key, v),
      group: GROUPABLE.has(key) ? { active: groupBy.includes(key), onToggle: (on) => changeGroup(key, on) } : undefined,
    }),
    onFilterDropdownOpenChange: (open: boolean) => { if (open) setPeek(true); },
  });
  const leaf = (r: MaterialTableRow) => r as Su10MaterialRow;

  const leafColumns: ColumnsType<MaterialTableRow> = [
    {
      title: 'Материал', key: 'name', width: 340, ...hf('name', filterSpecs.name),
      render: (_v, r) => {
        const row = leaf(r);
        return (
          <Space size={4}>
            {row.material_name}
            <Tag>{MATERIAL_REQUEST_TYPE_SHORT_LABELS[row.request_type as keyof typeof MATERIAL_REQUEST_TYPE_SHORT_LABELS] ?? row.request_type}</Tag>
          </Space>
        );
      },
    },
    {
      title: 'Объект', key: 'project', width: 200, ...hf('project', filterSpecs.project),
      render: (_v, r) => {
        const row = leaf(r);
        return row.project_name ? `${row.project_code ? `${row.project_code} · ` : ''}${row.project_name}` : '—';
      },
    },
    { title: 'Ед.', key: 'unit', width: 70, ...hf('unit', filterSpecs.unit), render: (_v, r) => leaf(r).unit },
    {
      title: 'Подрядчик', key: 'contractor', width: 160, ...hf('contractor', filterSpecs.contractor),
      render: (_v, r) => leaf(r).contractor_name ?? '—',
    },
    {
      title: 'Заявка', key: 'req', width: 110, ...hf('req', filterSpecs.req),
      render: (_v, r) => {
        const row = leaf(r);
        return row.request_no ? <a onClick={(e) => { e.stopPropagation(); setOpenRequestId(row.request_id); }}>{requestNumber(row.project_code, row.request_no)}</a> : '—';
      },
    },
    {
      title: 'Ответственный', key: 'resp', width: 210, ...hf('resp', filterSpecs.resp),
      render: (_v, r) => {
        const row = leaf(r);
        const catNames = row.category_id ? respByCategory.get(row.category_id) ?? [] : [];
        const catIds = row.category_id ? respIdsByCategory.get(row.category_id) ?? [] : [];
        return (
          <ResponsibleSelect
            value={row.assigned_responsible_id}
            assignedName={row.assigned_responsible_name}
            categoryNames={catNames}
            categoryIds={catIds}
            assignable={assignable}
            assignableReady={assignableQ.isSuccess}
            canAssign={canAssign}
            saving={assignMut.isPending && assignMut.variables?.id === row.request_item_id}
            onAssign={(userId) => assignMut.mutate({ id: row.request_item_id, userId })}
          />
        );
      },
    },
    {
      title: 'Дата поставки', key: 'delivery', width: 130, ...hf('delivery', filterSpecs.delivery),
      render: (_v, r) => { const v = leaf(r).delivery_date; return v ? fmtRuDate(v) : <span style={{ color: '#bfbfbf' }}>—</span>; },
    },
    {
      title: 'Запрошено', key: 'requested', width: 110, align: 'right', ...hf('requested', filterSpecs.requested),
      render: (_v, r) => round4(leaf(r).requested),
    },
    {
      title: 'Осталось заказать', key: 'remaining', width: 140, align: 'right', ...hf('remaining', filterSpecs.remaining),
      render: (_v, r) => {
        const v = leaf(r).remaining;
        return v == null ? <span style={{ color: '#bfbfbf' }}>не применяется</span>
          : <strong style={{ color: v > EPS ? '#1677ff' : '#bfbfbf' }}>{round4(v)}</strong>;
      },
    },
    {
      title: 'Категория', key: 'category', width: 200, ...hf('category', filterSpecs.category),
      render: (_v, r) => leaf(r).category_name ?? '—',
    },
  ];

  // Групповая строка: подпись в первом видимом столбце + компактное назначение всей группе.
  const renderGroup = (node: GroupNode<Su10MaterialRow>) => (
    <Space size={8} onClick={(e) => e.stopPropagation()}>
      <strong>
        {node.label}{' '}
        <span style={{ color: '#8c8c8c', fontWeight: 400 }}>· {node.count} поз., запрошено {round4(node.agg.requested ?? 0)}</span>
      </strong>
      {canAssign && (
        <Tooltip title={truncated ? 'Набор усечён — сузьте фильтры, чтобы назначить всей группе' : ''}>
          <Select
            size="small" style={{ width: 190 }} variant="filled" allowClear showSearch
            placeholder="Назначить ответств." disabled={truncated}
            value={null}
            options={assignable.map((u) => ({ value: u.id, label: u.full_name }))}
            optionFilterProp="label"
            onChange={(userId) => assignGroup(node, userId ?? null)}
          />
        </Tooltip>
      )}
    </Space>
  );

  const ordered = applyColumnPrefs(leafColumns, prefs);
  const columns = treeMode ? applyGroupSpan(ordered, renderGroup) : ordered;

  const viewCount = (() => {
    let n = 0;
    for (const k of Object.keys(colFilters)) if (colFilters[k] && !prefs.hidden[k]) n++;
    return n + groupBy.filter((k) => !prefs.hidden[k]).length;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* Строка 1 — основные фильтры и действия */}
      <div style={{ flexShrink: 0, paddingTop: 4, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          allowClear showSearch placeholder="Все объекты" style={{ width: 260 }}
          value={projectId} onChange={(v) => changeFilter(setProjectId, v)}
          optionFilterProp="label"
          options={(facets?.projects ?? []).map((p) => ({ value: p.id, label: `${p.code ? `${p.code} · ` : ''}${p.name ?? ''}` }))}
        />
        <Select
          allowClear showSearch placeholder="Все подрядчики" style={{ width: 200 }}
          value={contractorId} onChange={(v) => changeFilter(setContractorId, v)}
          optionFilterProp="label"
          options={(facets?.contractors ?? []).map((c) => ({ value: c.id, label: c.name ?? '—' }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => materialsQ.refetch()} loading={materialsQ.isFetching}>Обновить</Button>
        <Badge count={filtersOpen ? 0 : hiddenActiveCount} size="small" offset={[-2, 2]}>
          <Button icon={<FilterOutlined />} type={filtersOpen ? 'primary' : 'default'} onClick={() => setFiltersOpen(!filtersOpen)}>
            Фильтры
          </Button>
        </Badge>
        <div style={{ flex: 1 }} />
        <Tooltip title={!lockedProjectId && selected.size > 0 ? 'Материалы без объекта — заказ не сформировать' : ''}>
          <Dropdown
            disabled={selectedRows.length === 0 || !lockedProjectId}
            menu={{
              items: [
                { key: 'order', icon: <ShoppingCartOutlined />, label: 'Заказ поставщику' },
                { key: 'tender', label: 'Тендер' },
              ],
              onClick: ({ key }) => setAction(key as 'order' | 'tender'),
            }}
          >
            <Button type="primary" icon={<ShoppingCartOutlined />}>
              Заказ{selectedRows.length > 0 ? ` (${selectedRows.length})` : ''} <DownOutlined />
            </Button>
          </Dropdown>
        </Tooltip>
        <ColumnSettingsButton store={materialsColumnsStore} />
      </div>

      {/* Строка 2 — редкие фильтры (за кнопкой «Фильтры») */}
      {filtersOpen && (
        <div style={{ flexShrink: 0, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            allowClear placeholder="Все виды заявок" style={{ width: 190 }}
            value={requestType} onChange={(v) => changeFilter(setRequestType, v)}
            options={MATERIAL_REQUEST_TYPES.map((t) => ({ value: t, label: MATERIAL_REQUEST_TYPE_LABELS[t] }))}
          />
          <Select
            allowClear showSearch placeholder="Все категории" style={{ width: 200 }}
            value={categoryId} onChange={(v) => changeFilter(setCategoryId, v)}
            optionFilterProp="label"
            options={(facets?.categories ?? []).map((c) => ({ value: c.id, label: c.name ?? '—' }))}
          />
          {viewCount > 0 && (
            <Tag>Отборы/группировка в заголовках: {viewCount}</Tag>
          )}
        </div>
      )}

      {truncated && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 8 }}
          message={`Показаны первые ${rows.length} из ${total}. Отборы и дерево строятся по показанным позициям — сузьте фильтр (объект, подрядчик, категория).`}
        />
      )}

      <div className="table-page-wrapper">
        <Table<MaterialTableRow>
          rowKey={(r) => (isGroupRow(r) ? r.key : r.request_item_id)}
          size="small"
          loading={materialsQ.isLoading}
          dataSource={tableData}
          columns={columns}
          locale={{ emptyText: <Empty description="Материалов по заявкам нет" /> }}
          rowSelection={{
            type: 'checkbox',
            checkStrictly: treeMode ? true : undefined,
            selectedRowKeys: [...selected],
            onChange: (keys) => setSelected(new Set(keys.map(String).filter((k) => !k.startsWith(GROUP_KEY_PREFIX)))),
            getCheckboxProps: (r) =>
              isGroupRow(r)
                ? { disabled: true, style: { display: 'none' } }
                : { disabled: !isEligible(r) || (selected.size > 0 && !!lockedProjectId && r.project_id !== lockedProjectId) },
          }}
          expandable={treeMode ? {
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)),
          } : undefined}
          pagination={needFull
            ? { ...DEFAULT_PAGINATION }
            : {
                ...DEFAULT_PAGINATION,
                current: Math.floor(offset / limit) + 1,
                pageSize: limit,
                total,
                onChange: (page, size) => {
                  if (size !== limit) { setLimit(size); setOffset(0); } else { setOffset((page - 1) * size); }
                  resetSelection();
                },
              }}
          scroll={{ x: 1400, y: 'flex' }}
        />
      </div>

      {action === 'order' && lockedProjectId && (
        <SupplierOrderModal
          create={{ projectId: lockedProjectId, rows: selectedRows }}
          onClose={() => { setAction(null); resetSelection(); materialsQ.refetch(); }}
          onChanged={() => materialsQ.refetch()}
        />
      )}
      {action === 'tender' && lockedProjectId && (
        <TenderCreateModal
          projectId={lockedProjectId}
          rows={selectedRows}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); resetSelection(); materialsQ.refetch(); }}
        />
      )}
      <RequestDetailModal id={openRequestId} onClose={() => setOpenRequestId(null)} />
    </div>
  );
}
