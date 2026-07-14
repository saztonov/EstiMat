import { useEffect, useMemo, useState } from 'react';
import { Select, Table, Button, Space, Empty, Tag, Tooltip, Popover, Checkbox, Badge, Alert, Dropdown } from 'antd';
import { ShoppingCartOutlined, ReloadOutlined, FilterOutlined, DownOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { MATERIAL_REQUEST_TYPES, MATERIAL_REQUEST_TYPE_LABELS } from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { usePersistedState } from '../../hooks/usePersistedState';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { round4 } from './requestConstants';
import { SupplierOrderModal } from './SupplierOrderModal';
import { TenderCreateModal } from './TenderCreateModal';
import { RequestDetailModal } from './RequestDetailModal';
import type { Su10MaterialRow, MaterialsFacets, CategoryResponsibles } from './types';

const EPS = 1e-6;
const KEY = 'estimat:requests-materials:';

// Второй уровень группировки: по категории работ или по заявке (взаимоисключающие).
type GroupSecond = 'category' | 'request' | null;

// Групповая строка дерева. Ключ строится по id (не по подписи) — подписи неуникальны.
interface GroupNode {
  _group: true;
  key: string;
  label: string;
  requestedSum: number;
  count: number;
  children: MaterialTableRow[];
}
type MaterialTableRow = GroupNode | Su10MaterialRow;
const isGroupRow = (r: MaterialTableRow): r is GroupNode => '_group' in r;

// Один уровень группировки: как извлечь id/подпись и как сортировать группы.
interface Level {
  prefix: string;
  idOf: (r: Su10MaterialRow) => string;
  labelOf: (r: Su10MaterialRow) => string;
  cmp: (a: Su10MaterialRow, b: Su10MaterialRow) => number;
}
const contractorLevel: Level = {
  prefix: 'c',
  idOf: (r) => r.contractor_id ?? 'none',
  labelOf: (r) => r.contractor_name || '— Без подрядчика',
  cmp: (a, b) => (a.contractor_name || '').localeCompare(b.contractor_name || '', 'ru'),
};
const categoryLevel: Level = {
  prefix: 'cat',
  idOf: (r) => r.category_id ?? 'none',
  labelOf: (r) => r.category_name || '— Без категории',
  cmp: (a, b) =>
    (a.category_sort ?? 9999) - (b.category_sort ?? 9999) ||
    (a.category_name || '').localeCompare(b.category_name || '', 'ru'),
};
// № заявки уникален только в рамках объекта → группируем по request_id, а в подпись
// добавляем объект (иначе заявки №1 из разных объектов слились бы в одну группу).
const requestLevel: Level = {
  prefix: 'req',
  idOf: (r) => r.request_id,
  labelOf: (r) => `№ ${r.request_no ?? '—'} · ${r.project_code || r.project_name || 'без объекта'}`,
  cmp: (a, b) =>
    (a.project_name || '').localeCompare(b.project_name || '', 'ru') || (a.request_no ?? 0) - (b.request_no ?? 0),
};

function groupRecursive(rows: Su10MaterialRow[], levels: Level[], keyPrefix: string): MaterialTableRow[] {
  const [level, ...rest] = levels;
  if (!level) return rows;
  const map = new Map<string, { sample: Su10MaterialRow; items: Su10MaterialRow[] }>();
  for (const r of rows) {
    const id = level.idOf(r);
    const g = map.get(id);
    if (g) g.items.push(r);
    else map.set(id, { sample: r, items: [r] });
  }
  return [...map.entries()]
    .sort((a, b) => level.cmp(a[1].sample, b[1].sample))
    .map(([id, g]) => {
      const key = `${keyPrefix}${level.prefix}:${id}`;
      return {
        _group: true,
        key,
        label: level.labelOf(g.sample),
        count: g.items.length,
        requestedSum: g.items.reduce((s, x) => s + Number(x.requested), 0),
        children: groupRecursive(g.items, rest, `${key}/`),
      } as GroupNode;
    });
}

// Строит дерево строк по включённым уровням (порядок фиксирован: подрядчик → категория|заявка).
function buildGroupedRows(
  rows: Su10MaterialRow[],
  groupContractor: boolean,
  groupSecond: GroupSecond,
): MaterialTableRow[] {
  const levels: Level[] = [];
  if (groupContractor) levels.push(contractorLevel);
  if (groupSecond === 'category') levels.push(categoryLevel);
  else if (groupSecond === 'request') levels.push(requestLevel);
  if (levels.length === 0) return rows;
  return groupRecursive(rows, levels, '');
}

/**
 * Вкладка «Материалы» (снабжение): свод материалов заявок (все виды) с фильтрами и серверной
 * пагинацией. Заказ поставщику (лот) формируется только из позиций СУ-10 и только по категориям,
 * за которые пользователь отвечает (справочник «Закупки»), либо админом. Объект берётся из
 * выбранных строк — лот всегда в рамках одного объекта. Кнопкой «Вид» список можно группировать
 * (по подрядчикам / категориям / заявкам): тогда грузится весь набор и выводится деревом с
 * пагинацией по группам. Значения фильтров и вида хранятся в localStorage.
 */
export function SU10MaterialsTab() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [projectId, setProjectId] = usePersistedState<string | undefined>(`${KEY}projectId`, undefined);
  const [contractorId, setContractorId] = usePersistedState<string | undefined>(`${KEY}contractorId`, undefined);
  const [requestType, setRequestType] = usePersistedState<string | undefined>(`${KEY}requestType`, 'su10');
  const [categoryId, setCategoryId] = usePersistedState<string | undefined>(`${KEY}categoryId`, undefined);
  const [filtersOpen, setFiltersOpen] = usePersistedState<boolean>(`${KEY}filtersOpen`, false);
  const [groupContractor, setGroupContractor] = usePersistedState<boolean>(`${KEY}groupContractor`, false);
  const [groupSecond, setGroupSecond] = usePersistedState<GroupSecond>(`${KEY}groupSecond`, null);
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<'order' | 'tender' | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);

  const grouped = groupContractor || groupSecond !== null;

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
    queryKey: [
      'su10-materials', projectId ?? '', contractorId ?? '', requestType ?? '', categoryId ?? '',
      grouped ? 'all' : limit, grouped ? 0 : offset,
    ],
    queryFn: () => {
      const p = new URLSearchParams();
      // При группировке грузим весь набор (сервер вернёт до потолка + meta.truncated).
      if (grouped) p.set('all', '1');
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
  const truncated = materialsQ.data?.meta.truncated ?? false;
  const facets = materialsQ.data?.meta.facets;

  // Сброс сохранённого в localStorage id, если объект/подрядчик/категория исчезли из фасетов
  // (иначе фильтр «зависнет» с пустым результатом без видимой причины).
  useEffect(() => {
    if (!materialsQ.isSuccess || !facets) return;
    if (projectId && !facets.projects.some((p) => p.id === projectId)) setProjectId(undefined);
    if (contractorId && !facets.contractors.some((c) => c.id === contractorId)) setContractorId(undefined);
    if (categoryId && !facets.categories.some((c) => c.id === categoryId)) setCategoryId(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialsQ.isSuccess, facets]);

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
  function changeGroupContractor(checked: boolean) { setGroupContractor(checked); setOffset(0); }
  function changeGroupSecond(v: GroupSecond) { setGroupSecond(v); setOffset(0); }
  function resetGrouping() { setGroupContractor(false); setGroupSecond(null); setOffset(0); }

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

  const tableData = useMemo(
    () => buildGroupedRows(rows, groupContractor, groupSecond),
    [rows, groupContractor, groupSecond],
  );

  // Раскрываем все группы, но пересобираем expandedKeys только при смене состава верхних групп,
  // а не на каждый refetch — иначе ручное сворачивание постоянно сбрасывалось бы.
  const groupSignature = useMemo(
    () => (grouped ? tableData.filter(isGroupRow).map((g) => g.key).join('|') : ''),
    [tableData, grouped],
  );
  useEffect(() => {
    if (!grouped) { setExpandedKeys([]); return; }
    const keys: string[] = [];
    const walk = (nodes: MaterialTableRow[]) => {
      for (const n of nodes) if (isGroupRow(n)) { keys.push(n.key); walk(n.children); }
    };
    walk(tableData);
    setExpandedKeys(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSignature]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.request_item_id)), [rows, selected]);
  const lockedProjectId = selectedRows[0]?.project_id ?? null;

  const hiddenActiveCount = (requestType ? 1 : 0) + (categoryId ? 1 : 0) + (grouped ? 1 : 0);

  // Групповая строка занимает всю ширину: «Материал» с colSpan на все колонки, остальные — 0.
  const hideForGroup = { onCell: (r: MaterialTableRow) => (isGroupRow(r) ? { colSpan: 0 } : {}) };

  const columns: ColumnsType<MaterialTableRow> = [
    {
      title: 'Материал', dataIndex: 'material_name', key: 'name',
      onCell: (r) => (isGroupRow(r) ? { colSpan: columns.length } : {}),
      render: (_v, r) => {
        if (isGroupRow(r)) {
          return (
            <strong>
              {r.label}{' '}
              <span style={{ color: '#8c8c8c', fontWeight: 400 }}>
                · {r.count} поз., запрошено {round4(r.requestedSum)}
              </span>
            </strong>
          );
        }
        return (
          <Space size={4}>
            {r.material_name}
            {r.request_type === 'su10' && r.remaining != null && r.remaining <= EPS && <Tag color="default">в заказах</Tag>}
          </Space>
        );
      },
    },
    {
      title: 'Объект', dataIndex: 'project_name', key: 'project', width: 200, ...hideForGroup,
      render: (v: string | null, r) =>
        isGroupRow(r) ? null : v ? `${r.project_code ? `${r.project_code} · ` : ''}${v}` : '—',
    },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 64, ...hideForGroup },
    { title: 'Категория', dataIndex: 'category_name', key: 'cat', width: 150, ...hideForGroup, render: (v: string | null) => v ?? '—' },
    { title: 'Вид работ', dataIndex: 'cost_type_name', key: 'ct', width: 150, ...hideForGroup, render: (v: string | null) => v ?? '—' },
    {
      title: 'Вид заявки', dataIndex: 'request_type', key: 'rtype', width: 150, ...hideForGroup,
      render: (v: string) => <Tag>{MATERIAL_REQUEST_TYPE_LABELS[v as keyof typeof MATERIAL_REQUEST_TYPE_LABELS] ?? v}</Tag>,
    },
    { title: 'Подрядчик', dataIndex: 'contractor_name', key: 'contractor', width: 160, ...hideForGroup, render: (v: string | null) => v ?? '—' },
    {
      title: 'Заявка', dataIndex: 'request_no', key: 'req', width: 90, ...hideForGroup,
      render: (v: number | null, r) => (isGroupRow(r) ? null : v ? <a onClick={() => setOpenRequestId(r.request_id)}>№ {v}</a> : '—'),
    },
    {
      title: 'Ответственный', key: 'resp', width: 170, ...hideForGroup,
      render: (_, r) => {
        if (isGroupRow(r)) return null;
        const names = r.category_id ? respByCategory.get(r.category_id) ?? [] : [];
        return names.length ? names.join(', ') : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    },
    { title: 'Запрошено', dataIndex: 'requested', key: 'requested', width: 100, align: 'right', ...hideForGroup, render: (v) => round4(v) },
    {
      title: 'В заказах', dataIndex: 'ordered', key: 'ordered', width: 110, align: 'right', ...hideForGroup,
      render: (v: number | null) => (v == null ? <span style={{ color: '#bfbfbf' }}>—</span> : Number(v) > 0 ? round4(v) : <span style={{ color: '#bfbfbf' }}>0</span>),
    },
    {
      title: 'Осталось распределить', dataIndex: 'remaining', key: 'remaining', width: 130, align: 'right', ...hideForGroup,
      render: (v: number | null) =>
        v == null ? <span style={{ color: '#bfbfbf' }}>не применяется</span>
          : <strong style={{ color: v > EPS ? '#1677ff' : '#bfbfbf' }}>{round4(v)}</strong>,
    },
  ];

  const viewContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 210 }}>
      <Checkbox checked={groupContractor} onChange={(e) => changeGroupContractor(e.target.checked)}>
        С подрядчиками
      </Checkbox>
      <Checkbox checked={groupSecond === 'category'} onChange={(e) => changeGroupSecond(e.target.checked ? 'category' : null)}>
        С категориями
      </Checkbox>
      <Checkbox checked={groupSecond === 'request'} onChange={(e) => changeGroupSecond(e.target.checked ? 'request' : null)}>
        С заказами (по заявке)
      </Checkbox>
      <div style={{ textAlign: 'right' }}>
        <Button size="small" disabled={!grouped} onClick={resetGrouping}>Сбросить</Button>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* Строка 1 — основные фильтры и действия */}
      <div style={{ flexShrink: 0, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
        <Badge count={filtersOpen ? 0 : hiddenActiveCount} size="small">
          <Button
            icon={<FilterOutlined />}
            type={filtersOpen ? 'primary' : 'default'}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
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
      </div>

      {/* Строка 2 — редкие фильтры и вид (за кнопкой «Фильтры») */}
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
          <Popover trigger="click" placement="bottomLeft" title="Группировка" content={viewContent}>
            <Badge dot={grouped}>
              <Button>Вид</Button>
            </Badge>
          </Popover>
        </div>
      )}

      {grouped && truncated && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 8 }}
          message={`Показаны первые ${rows.length} позиций из ${total}. Сузьте фильтр (объект, подрядчик, категория), чтобы увидеть все.`}
        />
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table<MaterialTableRow>
          rowKey={(r) => (isGroupRow(r) ? r.key : r.request_item_id)}
          size="small"
          loading={materialsQ.isLoading}
          dataSource={tableData}
          columns={columns}
          locale={{ emptyText: <Empty description="Материалов по заявкам нет" /> }}
          rowSelection={{
            type: 'checkbox',
            checkStrictly: grouped ? true : undefined,
            selectedRowKeys: [...selected],
            onChange: (keys) => setSelected(new Set(keys.map(String).filter((k) => !k.includes(':')))),
            getCheckboxProps: (r) =>
              isGroupRow(r)
                ? { disabled: true, style: { display: 'none' } }
                : { disabled: !isEligible(r) || (selected.size > 0 && !!lockedProjectId && r.project_id !== lockedProjectId) },
          }}
          expandable={grouped ? {
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)),
          } : undefined}
          pagination={grouped
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
          scroll={{ x: 1500 }}
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
