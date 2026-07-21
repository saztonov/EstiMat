import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  App,
  Button,
  Checkbox,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CaretRightOutlined,
  CaretDownOutlined,
  DownOutlined,
  LockOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { BulkAssignResult, Organization, VorMark, VorMarksMap } from '@estimat/shared';
import { api, apiFetch } from '../../services/api';
import { CostTypeGroupBlock } from '../estimates/components/CostTypeGroupBlock';
import { VorListModal } from '../estimates/components/VorListModal';
import {
  buildCostTypeGroups,
  formatMoney,
  type CostTypeCiphers,
  type CostTypeGroup,
  type EstimateItem,
  type ItemContractor,
} from '../estimates/components/types';
import type { ZoneNode } from '../estimates/components/location';
import {
  LocationBadgesRow,
  locationParts,
  toLocationSnapshot,
  type ZoneIndex,
} from '../estimates/components/LocationBadges';
import { LocationFilterPopover } from '../estimates/workspace/LocationFilterPopover';
import { useContractorLocationFilter } from './useContractorLocationFilter';
import { RowAssignPopover } from './assign/RowAssignPopover';
import { GroupAssignPopover } from './assign/GroupAssignPopover';
import { GroupSelectionBar } from './assign/GroupSelectionBar';
import { countUnassigned, useAssignPlan } from './assign/useAssignPlan';
import { allocationLabel, type AssignInput, type BulkAssignDraft } from './assign/types';

interface Props {
  estimateId: string;
  items: EstimateItem[];
  /** Инженер/админ — может назначать; подрядчик — только просмотр своих строк. */
  canAssign: boolean;
  viewerIsContractor: boolean;
  /** Объект строк — для справочника типов в поповере локации (вид инженера). */
  projectId: string;
  /** Шифры РД по видам работ — тегами в шапке блока (просмотр; правка только в разделе «Смета»). */
  costTypeCiphers: CostTypeCiphers;
  zones: ZoneNode[];
  zoneIndex: ZoneIndex;
  onChanged: () => void;
}

const NO_CATEGORY = '__none__';
const num = (v: string | number | null | undefined) => Number(v ?? 0);

// Подпись подрядчика строки с его объёмом/долей.
function contractorLabel(c: ItemContractor) {
  if (c.assigned_percent != null) return `${c.contractor_name ?? '—'} · ${num(c.assigned_percent)}%`;
  if (c.assigned_qty != null) return `${c.contractor_name ?? '—'} · ${num(c.assigned_qty)}`;
  return `${c.contractor_name ?? '—'} · весь объём`;
}

export function ContractorsSmetaTab({
  estimateId,
  items,
  canAssign,
  viewerIsContractor,
  projectId,
  costTypeCiphers,
  zones,
  zoneIndex,
  onChanged,
}: Props) {
  const { message, modal } = App.useApp();
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const [filterContractorIds, setFilterContractorIds] = useState<string[]>([]);

  // Инженеру/админу видны цены (как на странице «Смета»).
  const showPrices = canAssign;

  // Организации-подрядчики для назначения (только инженеру/админу).
  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Organization[] }>('/organizations'),
    enabled: canAssign,
  });
  const contractorOptions = useMemo(
    () =>
      (orgsData?.data ?? [])
        .filter((o) => o.type === 'subcontractor' || o.type === 'general_contractor')
        .map((o) => ({ value: o.id, label: o.name })),
    [orgsData],
  );

  // Опции фильтра — только подрядчики, реально назначенные на работы в этой смете
  // (источник — item_contractors, а не справочник организаций).
  const assignedContractorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items)
      for (const c of it.item_contractors ?? [])
        if (!map.has(c.contractor_id)) map.set(c.contractor_id, c.contractor_name ?? '—');
    return [...map]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [items]);

  // Отметки ВОР строк — тот же ключ, что на «Смете»: кэш общий, переход между разделами не
  // даёт лишнего запроса. Подрядчику ВОР закрыт (роут для его роли не открыт), поэтому не
  // запрашиваем вовсе. Назначение подрядчика в снимок ВОР не входит (contentHash по составу
  // строки), поэтому после мутаций назначений этот ключ инвалидировать НЕ нужно.
  const { data: vorMarks } = useQuery({
    queryKey: ['estimate-vor-marks', estimateId],
    queryFn: () =>
      api.get<{ data: VorMarksMap }>(`/estimates/${estimateId}/vors/marks`).then((r) => r.data),
    enabled: !viewerIsContractor && !!estimateId,
  });
  // undefined только у подрядчика: по !!vorByItem блок решает ширину колонки раскрытия, и
  // пустая-но-заданная карта не даёт ширине «прыгнуть» после догрузки отметок.
  const vorByItem = useMemo(
    () => (viewerIsContractor ? undefined : new Map<string, VorMark>(Object.entries(vorMarks ?? {}))),
    [viewerIsContractor, vorMarks],
  );
  const [vorListOpen, setVorListOpen] = useState(false);
  // Клик по метке «В» — открыть список ВОР сметы. Конкретный ВОР не подсвечиваем: агрегатная
  // отметка не хранит его id (как и на «Смете»).
  const openVorList = useCallback(() => setVorListOpen(true), []);

  // Локационный отбор раздела (корпус/этажи/тип) — своё состояние, не связано со страницей «Смета».
  const {
    value: locFilter,
    onChange: onLocFilterChange,
    clear: clearLocFilter,
    typeOptions: locTypeOptions,
    filterItems: filterByLocation,
  } = useContractorLocationFilter(items);

  const visibleItems = useMemo(() => {
    let res = onlyUnassigned
      ? items.filter((it) => num(it.remaining_qty ?? it.quantity) > 1e-6)
      : items;
    if (filterContractorIds.length)
      res = res.filter((it) =>
        (it.item_contractors ?? []).some((c) => filterContractorIds.includes(c.contractor_id)),
      );
    return filterByLocation(res);
  }, [items, onlyUnassigned, filterContractorIds, filterByLocation]);
  const groups = useMemo(
    () => buildCostTypeGroups(visibleItems, [], [], undefined, costTypeCiphers),
    [visibleItems, costTypeCiphers],
  );

  // Секции категорий (категория → виды работ), как на странице «Смета».
  const sections = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { id: string; name: string; groups: CostTypeGroup[] }>();
    for (const g of groups) {
      const key = g.costCategoryId ?? NO_CATEGORY;
      if (!map.has(key)) {
        map.set(key, { id: key, name: g.costCategoryName ?? 'Без категории', groups: [] });
        order.push(key);
      }
      map.get(key)!.groups.push(g);
    }
    return order.map((k) => map.get(k)!);
  }, [groups]);

  const assignMutation = useMutation({
    mutationFn: (v: AssignInput & { itemIds: string[] }) => {
      if (v.mode === 'percent')
        return api.post('/contractors/assignments', { mode: 'percent', contractorId: v.contractorId, itemIds: v.itemIds, percent: v.percent });
      if (v.mode === 'qty')
        return api.post('/contractors/assignments', {
          mode: 'qty',
          contractorId: v.contractorId,
          assignments: v.itemIds.map((id) => ({ itemId: id, assignedQty: v.qty })),
        });
      return api.post('/contractors/assignments', { mode: 'remainder', contractorId: v.contractorId, itemIds: v.itemIds });
    },
    onSuccess: () => {
      message.success('Исполнитель назначен');
      onChanged();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: (v: { itemIds: string[]; contractorId?: string }) =>
      apiFetch('/contractors/assignments', { method: 'DELETE', body: JSON.stringify(v) }),
    onSuccess: () => {
      message.success('Исполнитель снят');
      onChanged();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const doAssign = (input: AssignInput, itemIds: string[]) => assignMutation.mutateAsync({ ...input, itemIds });

  // Массовое назначение: применяется частично и возвращает отчёт (что перезаписано, что
  // пропущено из-за заявок). Сообщение об итоге строит вызывающий — оно зависит от отчёта.
  const bulkAssignMutation = useMutation({
    mutationFn: (v: BulkAssignDraft & { itemIds: string[]; strategy: 'replace' | 'unassigned_only' }) =>
      api
        .post<{ data: BulkAssignResult }>('/contractors/assignments/bulk', {
          estimateId,
          contractorId: v.contractorId,
          itemIds: v.itemIds,
          strategy: v.strategy,
          allocation: v.allocation,
        })
        .then((r) => r.data),
    onSuccess: () => onChanged(),
    onError: (e: Error) => message.error(e.message),
  });

  const typeKey = (g: CostTypeGroup) => g.costTypeId ?? NO_CATEGORY;

  // ── Режим отметки строк («назначить на несколько работ») ──
  // Живёт ровно в одном виде работ: назначать «через весь экран» смысла нет, а панель действий
  // должна стоять рядом с отмеченными строками.
  const [selectSession, setSelectSession] = useState<(BulkAssignDraft & { typeKey: string }) | null>(null);
  const [selectedWorkIds, setSelectedWorkIds] = useState<Set<string>>(new Set());
  const exitSelect = useCallback(() => {
    setSelectSession(null);
    setSelectedWorkIds(new Set());
  }, []);
  const toggleWork = useCallback(
    (id: string, selected: boolean) =>
      setSelectedWorkIds((prev) => {
        const n = new Set(prev);
        if (selected) n.add(id);
        else n.delete(id);
        return n;
      }),
    [],
  );

  // Смена отбора меняет набор видимых строк — режим гасим целиком: назначать можно только на
  // то, что видно. Завязка именно на значения фильтров, а НЕ на visibleItems/groups: последние
  // пересоздаются на каждом refetch (в т.ч. по фокусу окна) и убивали бы режим на ровном месте.
  useEffect(() => {
    exitSelect();
  }, [onlyUnassigned, filterContractorIds, filterByLocation, exitSelect]);

  const buildPlan = useAssignPlan();

  // Итог массового назначения: сначала факт, потом причины пропусков.
  const reportBulkResult = useCallback(
    (res: BulkAssignResult, works: EstimateItem[]) => {
      const nameById = new Map(works.map((w) => [w.id, w.description]));
      if (res.assigned === 0) {
        message.warning(
          res.blocked.length > 0
            ? 'Назначать нечего: все строки защищены заявками'
            : 'Назначать нечего: подходящих строк нет',
        );
        return;
      }
      const parts = [`назначено строк: ${res.assigned}`];
      if (res.replacedRows > 0) parts.push(`перезаписано: ${res.replacedRows}`);
      if (res.blocked.length > 0) parts.push(`пропущено: ${res.blocked.length}`);
      message.success(parts.join(' · '));

      if (res.blocked.length > 0) {
        const shown = res.blocked.slice(0, 20);
        modal.info({
          title: 'Назначено не на все строки',
          width: 520,
          content: (
            <div>
              <p style={{ marginTop: 0 }}>
                По этим строкам подрядчик уже оформил заявку на материалы — исполнитель у них не
                менялся.
              </p>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {shown.map((b) => (
                  <li key={b.itemId}>
                    {nameById.get(b.itemId) ?? 'Строка сметы'}
                    {b.contractors.length > 0 && (
                      <span style={{ color: '#8c8c8c' }}>
                        {' '}
                        — {b.contractors.map((c) => c.contractorName ?? '—').join(', ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {res.blocked.length > shown.length && (
                <p style={{ marginBottom: 0, color: '#8c8c8c' }}>
                  …и ещё {res.blocked.length - shown.length}
                </p>
              )}
            </div>
          ),
        });
      }
    },
    [message, modal],
  );

  // Назначение на вид работ целиком либо только на строки без подрядчика.
  const runGroupAssign = useCallback(
    async (group: CostTypeGroup, scope: 'all' | 'new', draft: BulkAssignDraft) => {
      const plan = buildPlan(group.works, draft.contractorId, scope);
      if (plan.targets.length === 0 && plan.locked.length === 0) {
        message.warning('Подходящих строк нет');
        return;
      }
      const itemIds = [...plan.targets, ...plan.locked].map((w) => w.id);

      const run = async () => {
        const res = await bulkAssignMutation.mutateAsync({
          ...draft,
          itemIds,
          strategy: scope === 'new' ? 'unassigned_only' : 'replace',
        });
        reportBulkResult(res, group.works);
      };

      // Диалог только когда есть что затирать или пропускать — иначе он лишний.
      if (plan.replaceCount === 0 && plan.locked.length === 0) return run();

      const contractorName =
        contractorOptions.find((o) => o.value === draft.contractorId)?.label ?? 'подрядчика';
      modal.confirm({
        title: scope === 'new' ? 'Назначить на новые строки?' : 'Назначить на весь вид работ?',
        width: 520,
        okText: plan.replaceCount > 0 ? 'Назначить и перезаписать' : 'Назначить',
        okButtonProps: { danger: plan.replaceCount > 0 },
        cancelText: 'Отмена',
        content: (
          <div>
            <div>Вид работ: «{group.costTypeName ?? 'Без вида работ'}»</div>
            <div>
              Подрядчик: {contractorName} · {allocationLabel(draft.allocation)}
            </div>
            <div>Строк в назначении: {plan.targets.length}</div>
            {plan.replaceCount > 0 && (
              <div>Будет перезаписано у других подрядчиков: {plan.replaceCount}</div>
            )}
            {plan.locked.length > 0 && (
              <div>Защищено заявками — пропустим: {plan.locked.length}</div>
            )}
            {plan.replaceCount > 0 && (
              <p style={{ marginBottom: 0, marginTop: 8 }}>
                Текущие подрядчики этих строк будут сняты.
              </p>
            )}
          </div>
        ),
        onOk: run,
      });
    },
    [buildPlan, bulkAssignMutation, contractorOptions, message, modal, reportBulkResult],
  );

  // Назначение на строки, отмеченные галочками.
  const runSelectedAssign = useCallback(
    async (group: CostTypeGroup) => {
      if (!selectSession) return;
      // Отмеченная строка могла исчезнуть из-за refetch — сверяемся с текущими видимыми.
      const visible = new Map(group.works.map((w) => [w.id, w]));
      const picked = [...selectedWorkIds].map((id) => visible.get(id)).filter((w): w is EstimateItem => !!w);
      if (picked.length === 0) {
        message.warning('Отмеченные строки больше не видны — отметьте заново');
        return;
      }
      const plan = buildPlan(picked, selectSession.contractorId, 'all');
      const itemIds = picked.map((w) => w.id);

      const run = async () => {
        const res = await bulkAssignMutation.mutateAsync({
          contractorId: selectSession.contractorId,
          allocation: selectSession.allocation,
          itemIds,
          strategy: 'replace',
        });
        reportBulkResult(res, group.works);
        exitSelect();
      };

      if (plan.replaceCount === 0 && plan.locked.length === 0) return run();

      modal.confirm({
        title: 'Перезаписать назначения?',
        width: 520,
        okText: plan.replaceCount > 0 ? 'Назначить и перезаписать' : 'Назначить',
        okButtonProps: { danger: plan.replaceCount > 0 },
        cancelText: 'Отмена',
        content: (
          <div>
            <div>Отмечено строк: {picked.length}</div>
            {plan.replaceCount > 0 && (
              <div>Из них назначены другим подрядчикам: {plan.replaceCount} — их назначения будут сняты</div>
            )}
            {plan.locked.length > 0 && <div>Защищено заявками — пропустим: {plan.locked.length}</div>}
          </div>
        ),
        onOk: run,
      });
    },
    [
      selectSession,
      selectedWorkIds,
      buildPlan,
      bulkAssignMutation,
      message,
      modal,
      reportBulkResult,
      exitSelect,
    ],
  );

  // Вход в режим отметки: разворачиваем вид и его категорию — иначе отмечать было бы нечего.
  const startSelect = (group: CostTypeGroup, draft: BulkAssignDraft) => {
    const key = typeKey(group);
    setCollapsedTypes((p) => {
      const n = new Set(p);
      n.delete(key);
      return n;
    });
    setCollapsedCats((p) => {
      const n = new Set(p);
      n.delete(group.costCategoryId ?? NO_CATEGORY);
      return n;
    });
    setSelectedWorkIds(new Set());
    setSelectSession({ ...draft, typeKey: key });
  };

  const toggleCat = (id: string) =>
    setCollapsedCats((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
        // Свернули категорию с активным режимом отметки — блок уходит из DOM, режим остался бы
        // включённым «вслепую».
        if (selectSession && groups.some((g) => (g.costCategoryId ?? NO_CATEGORY) === id && typeKey(g) === selectSession.typeKey))
          exitSelect();
      }
      return n;
    });
  const toggleType = (id: string | null) =>
    setCollapsedTypes((prev) => {
      const n = new Set(prev);
      const k = id ?? NO_CATEGORY;
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const expandAll = () => {
    setCollapsedCats(new Set());
    setCollapsedTypes(new Set());
  };
  const collapseAll = () => {
    setCollapsedCats(new Set(groups.map((g) => g.costCategoryId ?? NO_CATEGORY)));
    setCollapsedTypes(new Set(groups.map(typeKey)));
    exitSelect(); // все блоки свёрнуты — отмечать больше нечего
  };

  // Сумма по набору видов работ (работы + их материалы).
  const groupsTotal = (gs: CostTypeGroup[]) =>
    gs.reduce(
      (acc, g) =>
        acc + g.works.reduce((a, w) => a + num(w.total) + w.materials.reduce((mm, m) => mm + num(m.total), 0), 0),
      0,
    );

  // Ячейка «Исполнитель»: чипы подрядчиков + статус остатка. Клик по всему блоку — назначение.
  const renderExecutor = (it: EstimateItem) => {
    const lockedIds = it.request_locked_contractor_ids ?? [];
    const chips = (it.item_contractors ?? []).map((c) => {
      // По строке уже заказаны материалы у этого подрядчика — снять его нельзя (сервер ответит
      // 409). Прячем крестик и объясняем причину, чтобы запрет не выглядел поломкой.
      const locked = lockedIds.includes(c.contractor_id);
      return (
        <Tooltip
          key={c.contractor_id}
          title={locked ? 'По этой строке оформлена заявка на материалы — исполнителя не снять' : undefined}
        >
          <Tag
            color="purple"
            icon={locked ? <LockOutlined /> : undefined}
            closable={canAssign && !locked}
            onClose={(e) => {
              e.preventDefault();
              e.stopPropagation(); // снятие подрядчика «крестиком» не должно открывать поповер
              clearMutation.mutate({ itemIds: [it.id], contractorId: c.contractor_id });
            }}
          >
            {contractorLabel(c)}
          </Tag>
        </Tooltip>
      );
    });
    const remaining = num(it.remaining_qty ?? it.quantity);
    let status: ReactNode;
    if (it.over_assigned) status = <Tag color="red">превышение</Tag>;
    else if (remaining > 1e-6)
      status = chips.length ? (
        <Tag color="orange">остаток {remaining.toLocaleString('ru-RU')}</Tag>
      ) : (
        <Tag>без подрядчика</Tag>
      );
    else status = <Tag color="green">распределено</Tag>;

    const content = (
      <Space size={4} wrap>
        {chips}
        {status}
      </Space>
    );

    if (!canAssign) return content;

    return (
      <RowAssignPopover
        contractorOptions={contractorOptions}
        onAssign={(input) => doAssign(input, [it.id])}
        trigger={
          <div style={{ cursor: 'pointer' }} title="Назначить исполнителя">
            {content}
          </div>
        }
      />
    );
  };

  const executorColumn: ColumnsType<EstimateItem> = [
    { title: 'Исполнитель', key: 'executor', width: 260, render: (_, it) => renderExecutor(it) },
  ];

  // Отбор по местоположению — общий для обоих видов (состояние своё у раздела).
  const locationFilterPopover = (
    <LocationFilterPopover
      zones={zones}
      typeOptions={locTypeOptions}
      value={locFilter}
      onChange={onLocFilterChange}
      onClear={clearLocFilter}
      showVolumeType={false}
    />
  );

  // ── Вид подрядчика: только его строки с его объёмом ──
  if (viewerIsContractor) {
    const myColumns: ColumnsType<EstimateItem> = [
      {
        title: 'Местоположение',
        key: 'location',
        width: 237,
        render: (_, it) => {
          const { zoneNames, floorsLabel, typeLabel } = locationParts(toLocationSnapshot(it), zoneIndex);
          return (
            <LocationBadgesRow
              zoneNames={zoneNames}
              floorsLabel={floorsLabel}
              typeLabels={typeLabel ? [typeLabel] : []}
            />
          );
        },
      },
      {
        title: 'Работа',
        dataIndex: 'description',
        key: 'description',
        render: (_, it) => (
          <span>
            {it.description}
            {it.rate_name && it.rate_name !== it.description && (
              <span style={{ color: '#8c8c8c' }}> · {it.rate_name}</span>
            )}
          </span>
        ),
      },
      { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
      // Подрядчик видит только назначенный ему объём (без полного объёма строки).
      { title: 'Кол-во', key: 'quantity', width: 110, align: 'right', render: (_, it) => num(it.my_effective_qty) },
    ];
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Тулбар вне области результатов: иначе отбор «до нуля строк» убрал бы кнопку сброса. */}
        <div style={{ flexShrink: 0, marginBottom: 12 }}>
          <Space wrap className="estimat-toolbar">
            {locationFilterPopover}
          </Space>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {groups.length === 0 ? (
            <Empty description="Строк нет" />
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {groups.map((g) => (
                <div key={g.costTypeId ?? '__none__'}>
                  <Space style={{ marginBottom: 8 }}>
                    <strong>
                      {g.costCategoryName ? `${g.costCategoryName} · ` : ''}
                      {g.costTypeName ?? 'Без вида работ'}
                    </strong>
                  </Space>
                  <Table<EstimateItem> rowKey="id" size="small" className="estimat-compact" pagination={false} dataSource={g.works} columns={myColumns} scroll={{ x: 700 }} />
                </div>
              ))}
            </Space>
          )}
        </div>
      </div>
    );
  }

  // ── Вид инженера/админа: как страница «Смета» + столбец «Исполнитель» слева ──
  return (
    <div className="contractors-smeta" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, marginBottom: 12 }}>
        <Space wrap className="estimat-toolbar">
          <Checkbox checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)}>
            Только с нераспределённым объёмом
          </Checkbox>
          <Select
            mode="multiple"
            allowClear
            showSearch
            placeholder="Фильтр по подрядчикам"
            style={{ width: 280 }}
            value={filterContractorIds}
            onChange={setFilterContractorIds}
            options={assignedContractorOptions}
            optionFilterProp="label"
            maxTagCount={1}
          />
          {locationFilterPopover}
          <Tooltip title="Развернуть всё">
            <Button type="text" size="small" icon={<DownOutlined />} onClick={expandAll} />
          </Tooltip>
          <Tooltip title="Свернуть всё">
            <Button type="text" size="small" icon={<UpOutlined />} onClick={collapseAll} />
          </Tooltip>
        </Space>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {sections.length === 0 && <Empty description="Строк нет" />}
        {sections.map((sec) => {
        const collapsed = collapsedCats.has(sec.id);
        return (
          <div key={sec.id} style={{ marginBottom: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px',
                background: '#eef2f7',
                border: '1px solid #e0e6ee',
                borderRadius: 8,
                userSelect: 'none',
                marginBottom: collapsed ? 0 : 8,
              }}
            >
              <span
                onClick={() => toggleCat(sec.id)}
                style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', color: '#8c8c8c' }}
                title={collapsed ? 'Развернуть' : 'Свернуть'}
              >
                {collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
              </span>
              <strong style={{ fontSize: 13 }}>{sec.name}</strong>
              <span style={{ color: '#8c8c8c', fontSize: 12 }}>Видов работ: {sec.groups.length}</span>
              <span style={{ flex: 1 }} />
              {showPrices && (
                <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(groupsTotal(sec.groups))}</span>
              )}
            </div>

            {!collapsed && (
              <div style={{ paddingLeft: 8 }}>
                {sec.groups.map((group, i) => (
                  <CostTypeGroupBlock
                    key={group.costTypeId ?? '__none__'}
                    group={group}
                    index={i}
                    editable={false}
                    collapsible
                    collapsed={collapsedTypes.has(typeKey(group))}
                    onToggleCollapsed={() => toggleType(group.costTypeId)}
                    showCategoryInTitle={false}
                    showLocationColumn
                    zones={zones}
                    projectId={projectId}
                    // estimateId — только чтобы отрисовались шифры РД (условие показа в блоке);
                    // назначения подрядчиков сервер выводит из itemIds и его не требуют.
                    estimateId={estimateId}
                    showPrices={showPrices}
                    vorByItem={vorByItem}
                    onOpenVor={openVorList}
                    leadingColumns={executorColumn}
                    selectWorksMode={canAssign && selectSession?.typeKey === typeKey(group)}
                    selectedWorkIds={selectedWorkIds}
                    onToggleWork={toggleWork}
                    headerExtra={
                      !canAssign ? undefined : selectSession?.typeKey === typeKey(group) ? (
                        <GroupSelectionBar
                          draft={selectSession}
                          onDraftChange={(d) => setSelectSession({ ...d, typeKey: selectSession.typeKey })}
                          selectedCount={selectedWorkIds.size}
                          contractorOptions={contractorOptions}
                          busy={bulkAssignMutation.isPending}
                          onSelectAll={() => setSelectedWorkIds(new Set(group.works.map((w) => w.id)))}
                          onClear={() => setSelectedWorkIds(new Set())}
                          onAssign={() => void runSelectedAssign(group)}
                          onCancel={exitSelect}
                        />
                      ) : (
                        <GroupAssignPopover
                          contractorOptions={contractorOptions}
                          totalCount={group.works.length}
                          unassignedCount={countUnassigned(group.works)}
                          onAssign={(scope, draft) => runGroupAssign(group, scope, draft)}
                          onStartSelect={(draft) => startSelect(group, draft)}
                        />
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>

      {/* Список ВОР по клику на метку «В». Только просмотр: экспорт, переход к фильтрам сметы
          и удаление ВОР — операции раздела «Смета». */}
      <VorListModal
        open={vorListOpen}
        onClose={() => setVorListOpen(false)}
        estimateId={estimateId}
        focusVorId={null}
        readOnly
      />
    </div>
  );
}
