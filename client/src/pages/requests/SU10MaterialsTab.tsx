import { useEffect, useMemo, useState } from 'react';
import { Select, Table, Button, Space, Empty, Tag, Tooltip, Badge, Alert, Dropdown, App, Modal, Typography, Popover } from 'antd';
import { ShoppingCartOutlined, ReloadOutlined, FilterOutlined, DownOutlined, TeamOutlined, ClearOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MATERIAL_REQUEST_TYPES, MATERIAL_REQUEST_TYPE_LABELS, MATERIAL_REQUEST_TYPE_SHORT_LABELS,
  PROCUREMENT_ASSIGN_ROLES,
} from '@estimat/shared';
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
import { MaterialScheduleModal } from './MaterialScheduleModal';
import { round4, requestNumber } from './requestConstants';
import { SupplierOrderModal } from './SupplierOrderModal';
import { TenderCreateModal } from './TenderCreateModal';
import { RequestDetailModal } from './RequestDetailModal';
import type { Su10MaterialGroupRow, Su10MaterialRow, MaterialsFacets, AssignableUser } from './types';

const { Text } = Typography;

const EPS = 1e-6;
const KEY = 'estimat:requests-materials:';
const fmtRuDate = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };

type MaterialTableRow = GroupRow<Su10MaterialGroupRow>;
const GROUPABLE = new Set(MATERIALS_COLUMN_DEFS.filter((d) => d.groupable).map((d) => d.key));

/**
 * Развернуть схлопнутую строку в исходные позиции заявок для модалок заказа и тендера: они
 * работают по request_item_id. Берём только позиции с положительным остатком — заказывать
 * перезаказанную дату нечего, а сервер всё равно отклонил бы её проверкой остатка.
 */
function expandItems(rows: Su10MaterialGroupRow[]): Su10MaterialRow[] {
  const out: Su10MaterialRow[] = [];
  for (const g of rows) {
    for (const it of g.items) {
      const requested = Number(it.requested);
      const placed = Number(it.placed);
      const remaining = requested - placed;
      if (remaining <= EPS) continue;
      out.push({
        request_item_id: it.request_item_id,
        request_id: it.request_id,
        request_no: it.request_no,
        request_type: g.request_type,
        status: g.status,
        project_id: g.project_id,
        project_name: g.project_name,
        project_code: g.project_code,
        cost_type_id: g.cost_type_id,
        cost_type_name: g.cost_type_name,
        category_id: g.category_id,
        category_name: g.category_name,
        category_sort: g.category_sort,
        cost_type_sort: g.cost_type_sort,
        material_id: g.material_id,
        material_name: g.material_name,
        unit: g.unit,
        agg_key: g.agg_key,
        delivery_date: it.delivery_date,
        requested,
        ordered: placed,
        remaining,
        contractor_id: g.contractor_id,
        contractor_name: g.contractor_name,
        assigned_responsibles: g.responsible ? [{ id: g.responsible.id, full_name: g.responsible.full_name ?? '' }] : [],
      });
    }
  }
  return out;
}

/** Назначение ответственного всему узлу дерева. Ответственный один — режим «добавить» не нужен. */
function GroupResponsibleAssign({ assignable, disabled, onAssign }: {
  assignable: AssignableUser[];
  disabled: boolean;
  onAssign: (userId: string) => void;
}) {
  const [picked, setPicked] = useState<string | undefined>();
  return (
    <Space size={4} onClick={(e) => e.stopPropagation()}>
      <Select
        size="small" style={{ width: 200 }} variant="filled" showSearch
        placeholder="Назначить ответств." disabled={disabled}
        value={picked}
        options={assignable.map((u) => ({ value: u.id, label: u.full_name }))}
        optionFilterProp="label"
        onChange={setPicked}
      />
      <Button size="small" type="primary" disabled={disabled || !picked}
        onClick={() => { if (picked) { onAssign(picked); setPicked(undefined); } }}>
        Назначить
      </Button>
    </Space>
  );
}

/**
 * Вкладка «Материалы» (снабжение): свод материалов заявок с настраиваемыми столбцами, отборами и
 * группировкой прямо в заголовках.
 *
 * Строка — ОДИН материал в рамках объекта, подрядчика и вида затрат: исходные позиции заявок
 * развёрнуты по датам поставки, и сервер схлопывает их обратно. Даты и номера заявок доступны
 * в модалке графика по клику на материал.
 *
 * Ответственный тоже один на строку и приходит уже разрешённым (точечное назначение → вид →
 * категория, с учётом замещения). Право вести заказ считает сервер (can_order) — раньше это
 * правило дублировалось здесь и разъезжалось со серверным.
 */
export function SU10MaterialsTab() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  // Назначать ответственных может только руководитель — как и подтверждать поставщика.
  const canAssign = PROCUREMENT_ASSIGN_ROLES.includes(user?.role as never);

  const [projectId, setProjectId] = usePersistedState<string | undefined>(`${KEY}projectId`, undefined);
  const [contractorId, setContractorId] = usePersistedState<string | undefined>(`${KEY}contractorId`, undefined);
  const [requestType, setRequestType] = usePersistedState<string | undefined>(`${KEY}requestType`, 'su10');
  const [categoryId, setCategoryId] = usePersistedState<string | undefined>(`${KEY}categoryId`, undefined);
  const [assigned, setAssigned] = usePersistedState<'all' | 'mine'>(`${KEY}assigned`, 'all');
  const [filtersOpen, setFiltersOpen] = usePersistedState<boolean>(`${KEY}filtersOpen`, false);
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [colFilters, setColFilters] = useState<ColumnFilters>({});
  const [peek, setPeek] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<'order' | 'tender' | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const [scheduleRow, setScheduleRow] = useState<Su10MaterialGroupRow | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignPick, setAssignPick] = useState<string | undefined>();

  // Настройки столбцов (порядок/видимость/уровни дерева) — в localStorage.
  const order = materialsColumnsStore.useStore((s) => s.order);
  const hidden = materialsColumnsStore.useStore((s) => s.hidden);
  const groupBy = materialsColumnsStore.useStore((s) => s.groupBy);
  const toggleGroupBy = materialsColumnsStore.useStore((s) => s.toggleGroupBy);
  const clearGroupBy = materialsColumnsStore.useStore((s) => s.clearGroupBy);
  const prefs = materialsColumnsStore.resolve(order, hidden);

  const assignableQ = useQuery({
    queryKey: ['procurement-assignable-users'],
    queryFn: () => api.get<{ data: AssignableUser[] }>('/procurement/assignable-users'),
    enabled: canAssign,
  });
  const assignable = assignableQ.data?.data ?? [];

  // Эффективный ответственный строки — для отбора и группировки по столбцу.
  const respText = (r: Su10MaterialGroupRow): string => r.responsible?.full_name ?? '';

  const levelMap = useMemo<Record<string, GroupLevel<Su10MaterialGroupRow> | undefined>>(() => ({
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
      key: 'resp', idOf: (r) => r.responsible?.id ?? 'none',
      labelOf: (r) => respText(r) || '— не назначены',
    },
    category: {
      key: 'category', idOf: (r) => r.category_id ?? 'none',
      labelOf: (r) => r.category_name || '— Без категории',
      cmp: (a, b) => (a.category_sort ?? 9999) - (b.category_sort ?? 9999) || (a.category_name || '').localeCompare(b.category_name || '', 'ru'),
    },
  }), []);

  const levels = levelsFromOrder(prefs.order, groupBy, prefs.hidden, levelMap);
  const treeMode = levels.length > 0;

  // Отбор и дерево строятся по всему набору → грузим all=1, когда они активны. «Назначенные мне»
  // тоже отбирается на клиенте, поэтому без полного набора он резал бы только текущую страницу.
  const needFull = peek || treeMode || assigned === 'mine' || hasActiveColumnFilters(colFilters, prefs.hidden);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (projectId) p.set('projectId', projectId);
    if (contractorId) p.set('contractorId', contractorId);
    if (requestType) p.set('requestType', requestType);
    if (categoryId) p.set('categoryId', categoryId);
    if (needFull) p.set('all', '1');
    else { p.set('limit', String(limit)); p.set('offset', String(offset)); }
    return p.toString();
  }, [projectId, contractorId, requestType, categoryId, needFull, limit, offset]);

  const materialsQ = useQuery({
    queryKey: ['su10-materials', qs],
    queryFn: () => api.get<{
      data: Su10MaterialGroupRow[];
      meta: { total: number; truncated: boolean; facets: MaterialsFacets };
    }>(`/supplier-orders/materials?${qs}`),
  });
  const rows = materialsQ.data?.data ?? [];
  const total = materialsQ.data?.meta.total ?? 0;
  const truncated = materialsQ.data?.meta.truncated ?? false;
  const facets = materialsQ.data?.meta.facets;

  useEffect(() => {
    if (!materialsQ.isSuccess || !facets) return;
    if (projectId && !facets.projects.some((p) => p.id === projectId)) setProjectId(undefined);
    if (contractorId && !facets.contractors.some((c) => c.id === contractorId)) setContractorId(undefined);
    if (categoryId && !facets.categories.some((c) => c.id === categoryId)) setCategoryId(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialsQ.isSuccess, facets]);

  /** Можно ли включить строку в заказ. Право приходит с сервера, здесь — только состояние строки. */
  const canOrder = (r: Su10MaterialGroupRow) =>
    r.can_order && r.request_type === 'su10' && (r.remaining ?? 0) > EPS && !!r.project_id;

  /**
   * Можно ли отметить строку чекбоксом. Шире, чем canOrder: руководитель отмечает строки и ради
   * назначения ответственного, в том числе полностью заказанные. Прежняя блокировка «только один
   * объект» была правилом заказа, протёкшим в общий выбор, — из-за неё нельзя было назначить
   * ответственного сразу на два объекта.
   */
  const canSelect = (r: Su10MaterialGroupRow) => canOrder(r) || canAssign;

  function resetSelection() { setSelected(new Set()); }
  function changeFilter<T>(setter: (v: T) => void, v: T) { setter(v); setOffset(0); resetSelection(); }
  function changeColFilter(key: string, v: ColumnFilters[string]) {
    setColFilters((f) => ({ ...f, [key]: v })); setOffset(0); resetSelection();
  }
  function changeGroup(key: string, on: boolean) { toggleGroupBy(key, on); setOffset(0); resetSelection(); }

  const filterSpecs = useMemo<Record<
    'name' | 'project' | 'contractor' | 'resp' | 'req' | 'unit' | 'delivery' | 'requested' | 'remaining' | 'category',
    ColumnFilterSpec<Su10MaterialGroupRow>
  >>(() => ({
    name: { kind: 'text', getText: (r) => r.material_name },
    project: { kind: 'multi', getText: (r) => r.project_name },
    contractor: { kind: 'multi', getText: (r) => r.contractor_name },
    // Список ФИО с поиском — раньше это было поле ввода, и выбрать ответственного было нельзя.
    // emptyLabel добавляет вариант для строк без ответственного: без него они не попадали ни в
    // один вариант и отобрать их можно было только группировкой.
    resp: { kind: 'multi', getText: (r) => r.responsible?.full_name ?? '', emptyLabel: '— не назначены' },
    // Многозначные ячейки схлопнутой строки: совпадение по любой заявке / любой дате.
    req: { kind: 'multi', getTexts: (r) => r.requests.map((q) => requestNumber(r.project_code, q.no ?? 0)) },
    unit: { kind: 'multi', getText: (r) => r.unit },
    delivery: { kind: 'dateRange', getDates: (r) => r.items.map((i) => i.delivery_date) },
    requested: { kind: 'numRange', getNum: (r) => r.requested },
    remaining: { kind: 'numRange', getNum: (r) => r.remaining },
    category: { kind: 'multi', getText: (r) => r.category_name },
  }), []);

  const filtered = useMemo(() => {
    const byColumns = applyColumnFilters(rows, colFilters, filterSpecs, prefs.hidden);
    // «Назначенные мне» — по эффективному ответственному, то есть с учётом замещения: заместитель
    // в свой период видит здесь и то, что ведёт за коллегу.
    return assigned === 'mine' ? byColumns.filter((r) => r.responsible?.id === user?.id) : byColumns;
  }, [rows, colFilters, filterSpecs, prefs.hidden, assigned, user?.id]);

  const tableData = useMemo<MaterialTableRow[]>(
    () => (treeMode ? groupRows(filtered, levels) : filtered),
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
      const next = new Set([...prev].filter((k) => rows.some((r) => r.row_key === k && canSelect(r))));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.row_key)), [rows, selected]);
  const orderableRows = useMemo(() => selectedRows.filter(canOrder), [selectedRows]); // eslint-disable-line react-hooks/exhaustive-deps
  // Заказ формируется по одному объекту; для назначения ответственного это ограничение не нужно.
  const orderProjectIds = new Set(orderableRows.map((r) => r.project_id));
  const orderProjectId = orderProjectIds.size === 1 ? [...orderProjectIds][0] ?? null : null;
  const hiddenActiveCount = (requestType ? 1 : 0) + (categoryId ? 1 : 0) + (assigned === 'mine' ? 1 : 0);

  // Что вообще можно сбросить: сюда входят и скрытые за кнопкой «Фильтры» отборы, иначе кнопка
  // выглядела бы неактивной при действующем, но не видном фильтре.
  const filtersDirty =
    !!projectId || !!contractorId || !!categoryId || requestType !== 'su10'
    || assigned === 'mine' || hasActiveColumnFilters(colFilters, prefs.hidden);

  function resetFilters() {
    setProjectId(undefined);
    setContractorId(undefined);
    setCategoryId(undefined);
    setRequestType('su10'); // дефолт вкладки, а не «все виды»: свод снабжения ведётся по СУ-10
    setAssigned('all');
    setColFilters({});
    setOffset(0);
    resetSelection();
  }

  function resetHierarchy() {
    clearGroupBy();
    setExpandedKeys([]);
    setOffset(0);
    resetSelection();
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['su10-materials'] });

  // Назначение ответственного по области строки: сервер сам развернёт его на все даты материала
  // и на будущие заявки с ним же.
  const setMut = useMutation({
    mutationFn: (v: { requestItemId: string; userId: string | null }) =>
      api.put(`/supplier-orders/materials/${v.requestItemId}/responsibles`, {
        userIds: v.userId ? [v.userId] : [],
      }),
    onSuccess: invalidate,
    onError: (e: Error) => message.error(e.message),
  });

  const bulkSetMut = useMutation({
    mutationFn: (v: { ids: string[]; userId: string | null }) =>
      api.patch('/supplier-orders/materials/responsibles', {
        requestItemIds: v.ids, userIds: v.userId ? [v.userId] : [], mode: 'replace',
      }),
    onSuccess: (_d, v) => {
      message.success(v.userId ? 'Ответственный назначен' : 'Ответственный снят');
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  /** Все позиции выделенных строк — по ним сервер вычислит области назначения. */
  const selectedItemIds = () => selectedRows.flatMap((r) => r.items.map((i) => i.request_item_id));

  function assignSelected(userId: string | null) {
    const ids = selectedItemIds();
    if (!ids.length) return;
    const materials = selectedRows.length;
    const target = userId ? assignable.find((u) => u.id === userId)?.full_name ?? '' : null;
    modal.confirm({
      title: userId ? 'Назначить ответственного' : 'Снять ответственного',
      content: userId
        ? `${target} станет ответственным за ${materials} материал(ов). Назначение действует на все даты поставки и на будущие заявки с этими материалами.`
        : `С ${materials} материал(ов) будет снято назначение — ответственный вернётся из справочника «Закупки».`,
      okText: userId ? 'Назначить' : 'Снять',
      cancelText: 'Отмена',
      onOk: async () => {
        await bulkSetMut.mutateAsync({ ids, userId });
        setAssignOpen(false);
        setAssignPick(undefined);
      },
    });
  }

  function assignGroup(node: GroupNode<Su10MaterialGroupRow>, userId: string) {
    const ids = node.items.flatMap((i) => i.items.map((x) => x.request_item_id));
    modal.confirm({
      title: 'Назначить ответственного группе',
      content: `Назначить выбранного на все ${node.items.length} материал(ов) узла «${node.label}»?`,
      okText: 'Назначить',
      cancelText: 'Отмена',
      onOk: () => bulkSetMut.mutateAsync({ ids, userId }),
    });
  }

  const hf = (key: string, spec: ColumnFilterSpec<Su10MaterialGroupRow>) => ({
    ...headerFilterCol<Su10MaterialGroupRow>({
      spec, value: colFilters[key], rows, onChange: (v) => changeColFilter(key, v),
      group: GROUPABLE.has(key) ? { active: groupBy.includes(key), onToggle: (on) => changeGroup(key, on) } : undefined,
    }),
    onFilterDropdownOpenChange: (open: boolean) => { if (open) setPeek(true); },
  });
  const leaf = (r: MaterialTableRow) => r as Su10MaterialGroupRow;

  const leafColumns: ColumnsType<MaterialTableRow> = [
    {
      title: 'Материал', key: 'name', width: 320, ...hf('name', filterSpecs.name),
      render: (_v, r) => {
        const row = leaf(r);
        return (
          <Space size={4} style={{ minWidth: 0 }}>
            <Tooltip title="Показать график поставок">
              <a onClick={(e) => { e.stopPropagation(); setScheduleRow(row); }}>{row.material_name}</a>
            </Tooltip>
            <Text type="secondary" style={{ fontSize: 12 }}>· {row.unit}</Text>
            {/* Тег вида заявки нужен, только когда показаны все виды: при фильтре «СУ-10» он шум. */}
            {!requestType && (
              <Tag>{MATERIAL_REQUEST_TYPE_SHORT_LABELS[row.request_type as keyof typeof MATERIAL_REQUEST_TYPE_SHORT_LABELS] ?? row.request_type}</Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Объект', key: 'project', width: 170, ellipsis: { showTitle: false }, ...hf('project', filterSpecs.project),
      render: (_v, r) => {
        const row = leaf(r);
        const text = row.project_name ? `${row.project_code ? `${row.project_code} · ` : ''}${row.project_name}` : '—';
        return <Tooltip title={text}>{text}</Tooltip>;
      },
    },
    { title: 'Ед.', key: 'unit', width: 70, ...hf('unit', filterSpecs.unit), render: (_v, r) => leaf(r).unit },
    {
      title: 'Подрядчик', key: 'contractor', width: 150, ellipsis: { showTitle: false }, ...hf('contractor', filterSpecs.contractor),
      render: (_v, r) => <Tooltip title={leaf(r).contractor_name ?? '—'}>{leaf(r).contractor_name ?? '—'}</Tooltip>,
    },
    {
      title: 'Заявка', key: 'req', width: 105, ...hf('req', filterSpecs.req),
      render: (_v, r) => {
        const row = leaf(r);
        if (!row.requests.length) return '—';
        const [first, ...rest] = row.requests;
        const label = requestNumber(row.project_code, first!.no ?? 0);
        const link = <a onClick={(e) => { e.stopPropagation(); setOpenRequestId(first!.id); }}>{label}</a>;
        if (!rest.length) return link;
        const all = row.requests.map((q) => requestNumber(row.project_code, q.no ?? 0)).join(', ');
        return <Tooltip title={all}><Space size={2}>{link}<Text type="secondary">+{rest.length}</Text></Space></Tooltip>;
      },
    },
    {
      title: 'Ответственный', key: 'resp', width: 190, ...hf('resp', filterSpecs.resp),
      render: (_v, r) => {
        const row = leaf(r);
        return (
          <ResponsibleSelect
            value={row.responsible?.id ?? null}
            valueName={row.responsible?.full_name ?? null}
            source={row.responsible?.source ?? null}
            assignable={assignable}
            canAssign={canAssign}
            saving={setMut.isPending && setMut.variables?.requestItemId === row.items[0]?.request_item_id}
            onSave={(userId) => {
              const first = row.items[0]?.request_item_id;
              if (first) setMut.mutate({ requestItemId: first, userId });
            }}
          />
        );
      },
    },
    {
      title: 'Поставка', key: 'delivery', width: 110, ...hf('delivery', filterSpecs.delivery),
      render: (_v, r) => {
        const row = leaf(r);
        const dates = row.items.map((i) => i.delivery_date).filter(Boolean) as string[];
        if (!dates.length) return <span style={{ color: '#bfbfbf' }}>—</span>;
        if (dates.length === 1) return fmtRuDate(dates[0]!);
        return (
          <Tooltip title={dates.map(fmtRuDate).join(', ')}>
            <a onClick={(e) => { e.stopPropagation(); setScheduleRow(row); }}>{dates.length} дат</a>
          </Tooltip>
        );
      },
    },
    {
      title: 'Запрошено', key: 'requested', width: 95, align: 'right', ...hf('requested', filterSpecs.requested),
      render: (_v, r) => round4(leaf(r).requested),
    },
    {
      title: 'Осталось заказать', key: 'remaining', width: 115, align: 'right', ...hf('remaining', filterSpecs.remaining),
      render: (_v, r) => {
        const row = leaf(r);
        const v = row.remaining;
        if (v == null) return <span style={{ color: '#bfbfbf' }}>не применяется</span>;
        return (
          <Space size={4}>
            <strong style={{ color: v > EPS ? '#1677ff' : '#bfbfbf' }}>{round4(v)}</strong>
            {row.has_overplaced && (
              <Tooltip title={`Заказано сверх заявленного: ${round4(row.overplaced)}`}>
                <Tag color="red" style={{ margin: 0 }}>перезаказ</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Категория', key: 'category', width: 170, ellipsis: { showTitle: false }, ...hf('category', filterSpecs.category),
      render: (_v, r) => leaf(r).category_name ?? '—',
    },
  ];

  const renderGroup = (node: GroupNode<Su10MaterialGroupRow>) => (
    <Space size={8} onClick={(e) => e.stopPropagation()}>
      <strong>
        {node.label}{' '}
        <span style={{ color: '#8c8c8c', fontWeight: 400 }}>· {node.count} поз.</span>
      </strong>
      {canAssign && (
        <Tooltip title={truncated ? 'Набор усечён — сузьте фильтры, чтобы назначить всей группе' : ''}>
          <GroupResponsibleAssign
            assignable={assignable}
            disabled={truncated}
            onAssign={(userId) => assignGroup(node, userId)}
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
        <Popover
          trigger="click"
          placement="bottomLeft"
          content={
            <Space direction="vertical" size={4} style={{ minWidth: 180 }}>
              <Button type="text" block style={{ textAlign: 'left' }} disabled={!filtersDirty} onClick={resetFilters}>
                Сбросить фильтры
              </Button>
              <Button type="text" block style={{ textAlign: 'left' }} disabled={groupBy.length === 0} onClick={resetHierarchy}>
                Сбросить иерархию
              </Button>
            </Space>
          }
        >
          <Tooltip title="Сброс">
            <Button icon={<ClearOutlined />} aria-label="Сброс" />
          </Tooltip>
        </Popover>
        <div style={{ flex: 1 }} />

        {canAssign && (
          <Tooltip title={truncated ? 'Набор усечён — сузьте фильтры' : ''}>
            <Button
              icon={<TeamOutlined />}
              disabled={selected.size === 0 || truncated}
              onClick={() => setAssignOpen(true)}
            >
              Ответственный{selected.size > 0 ? ` (${selected.size})` : ''}
            </Button>
          </Tooltip>
        )}

        <Tooltip title={
          orderableRows.length === 0 ? ''
            : orderProjectIds.size > 1 ? 'Выбраны материалы разных объектов — заказ формируется по одному'
              : !orderProjectId ? 'Материалы без объекта — заказ не сформировать' : ''
        }>
          <Dropdown
            disabled={orderableRows.length === 0 || !orderProjectId}
            menu={{
              items: [
                { key: 'order', icon: <ShoppingCartOutlined />, label: 'Заказ поставщику' },
                { key: 'tender', label: 'Тендер' },
              ],
              onClick: ({ key }) => setAction(key as 'order' | 'tender'),
            }}
          >
            <Button type="primary" icon={<ShoppingCartOutlined />}>
              Заказ{orderableRows.length > 0 ? ` (${orderableRows.length})` : ''} <DownOutlined />
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
          <Select
            style={{ width: 190 }}
            value={assigned} onChange={(v) => changeFilter(setAssigned, v)}
            options={[
              { value: 'all', label: 'Все ответственные' },
              { value: 'mine', label: 'Назначенные мне' },
            ]}
          />
          {viewCount > 0 && <Tag>Отборы/группировка в заголовках: {viewCount}</Tag>}
        </div>
      )}

      {truncated && (
        <Alert type="warning" showIcon style={{ marginBottom: 8, flexShrink: 0 }}
          message={`Показаны первые ${rows.length} из ${total}. Отборы и дерево строятся по показанным — сузьте фильтры сверху.`} />
      )}

      <div className="table-page-wrapper">
        <Table<MaterialTableRow>
          className="estimat-compact estimat-th-nowrap"
          rowKey={(r) => (isGroupRow(r) ? r.key : r.row_key)}
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
                : { disabled: !canSelect(r) },
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
          scroll={{ x: 1060, y: 'flex' }}
        />
      </div>

      {/* Массовое назначение: выбор сотрудника, затем подтверждение с охватом */}
      <Modal
        open={assignOpen}
        title="Ответственный за выбранные материалы"
        onCancel={() => { setAssignOpen(false); setAssignPick(undefined); }}
        footer={[
          <Button key="clear" danger onClick={() => assignSelected(null)}>Снять ответственного</Button>,
          <Button key="cancel" onClick={() => { setAssignOpen(false); setAssignPick(undefined); }}>Отмена</Button>,
          <Button key="ok" type="primary" disabled={!assignPick} onClick={() => assignSelected(assignPick ?? null)}>
            Назначить
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Text type="secondary">
            Выбрано материалов: {selectedRows.length}. Назначение действует на все даты поставки
            и на будущие заявки с этими материалами у того же объекта и подрядчика.
          </Text>
          <Select
            showSearch style={{ width: '100%' }} placeholder="Выберите сотрудника"
            value={assignPick} onChange={setAssignPick}
            optionFilterProp="label"
            options={assignable.map((u) => ({ value: u.id, label: u.full_name }))}
          />
        </Space>
      </Modal>

      {action === 'order' && orderProjectId && (
        <SupplierOrderModal
          create={{ projectId: orderProjectId, rows: expandItems(orderableRows) }}
          onClose={() => { setAction(null); resetSelection(); materialsQ.refetch(); }}
          onChanged={() => materialsQ.refetch()}
        />
      )}
      {action === 'tender' && orderProjectId && (
        <TenderCreateModal
          projectId={orderProjectId}
          rows={expandItems(orderableRows)}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); resetSelection(); materialsQ.refetch(); }}
        />
      )}
      {scheduleRow && <MaterialScheduleModal row={scheduleRow} onClose={() => setScheduleRow(null)} />}
      <RequestDetailModal id={openRequestId} onClose={() => setOpenRequestId(null)} />
    </div>
  );
}
