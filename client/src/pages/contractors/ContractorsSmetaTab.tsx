import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Empty, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CaretRightOutlined,
  CaretDownOutlined,
  DownOutlined,
  LockOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { VorMark, VorMarksMap, VorScopeItem } from '@estimat/shared';
import { api } from '../../services/api';
import { CostTypeGroupBlock } from '../estimates/components/CostTypeGroupBlock';
import {
  buildCostTypeGroups,
  formatMoney,
  sumWorksTotal,
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
import { useInitialCollapsedTypes } from '../estimates/workspace/useInitialCollapsedTypes';
import { useContractorLocationFilter } from './useContractorLocationFilter';
import type { ContractFilter } from './vor/VorObjectListModal';

interface Props {
  estimateId: string;
  items: EstimateItem[];
  /** Инженер/админ — видит цены и реестр ВОР; подрядчик — только свои строки. */
  canAssign: boolean;
  viewerIsContractor: boolean;
  /** Объект строк — для справочника типов в поповере локации (вид инженера). */
  projectId: string;
  /** Шифры РД по видам работ — тегами в шапке блока (просмотр; правка только в разделе «Смета»). */
  costTypeCiphers: CostTypeCiphers;
  zones: ZoneNode[];
  zoneIndex: ZoneIndex;
  /** Открыть реестр ВОР объекта (он один на раздел — им же владеет страница). */
  onOpenVorRegistry: () => void;
  /** Показывать только строки одного договора (вход по кнопке перехода из реестра ВОР). */
  contractFilter?: ContractFilter | null;
  onClearContractFilter?: () => void;
}

const NO_CATEGORY = '__none__';
const num = (v: string | number | null | undefined) => Number(v ?? 0);

// Подрядчики набора работ без повторов — для правой части заголовков «Категория» и «Вид работ».
function contractorsOf(works: EstimateItem[]): ItemContractor[] {
  const byId = new Map<string, ItemContractor>();
  for (const w of works)
    for (const c of w.item_contractors ?? []) if (!byId.has(c.contractor_id)) byId.set(c.contractor_id, c);
  return [...byId.values()];
}

// Подрядчики группы тегами: длинный список не должен разрывать строку заголовка.
function ContractorTags({ contractors }: { contractors: ItemContractor[] }) {
  if (contractors.length === 0) return null;
  const shown = contractors.slice(0, 3);
  const names = contractors.map((c) => c.contractor_name ?? '—');
  return (
    <Space size={4}>
      {shown.map((c) => (
        <Tag key={c.contractor_id} color="purple" style={{ marginInlineEnd: 0 }}>
          {c.contractor_name ?? '—'}
        </Tag>
      ))}
      {contractors.length > shown.length && (
        <Tooltip title={names.join(', ')}>
          <Tag color="purple" style={{ marginInlineEnd: 0 }}>
            +{contractors.length - shown.length}
          </Tag>
        </Tooltip>
      )}
    </Space>
  );
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
  onOpenVorRegistry,
  contractFilter = null,
  onClearContractFilter,
}: Props) {
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const [filterContractorIds, setFilterContractorIds] = useState<string[]>([]);

  // Инженеру/админу видны цены (как на странице «Смета»).
  const showPrices = canAssign;

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
  // запрашиваем вовсе.
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
  // Клик по метке «В» — открыть реестр ВОР объекта (тот же, что по кнопке «ВОР»: двух разных
  // списков ВОР в одном разделе быть не должно). Конкретный ВОР не подсвечиваем: агрегатная
  // отметка не хранит его id (как и на «Смете»).
  const openVorList = useCallback(() => onOpenVorRegistry(), [onOpenVorRegistry]);

  // Строки договора: состав ВОР пересекается с назначениями подрядчика. Ключ тот же, что у
  // модалки назначения — кэш общий, а после снятия подрядчика набор пересчитается сам.
  const { data: contractScope, isLoading: contractScopeLoading } = useQuery({
    queryKey: ['vor-scope', estimateId, contractFilter?.vorId],
    queryFn: () =>
      api
        .get<{ data: { items: VorScopeItem[] } }>(
          `/estimates/${estimateId}/vors/${contractFilter!.vorId}/items`,
        )
        .then((r) => r.data),
    enabled: !!contractFilter && !viewerIsContractor,
  });
  const contractItemIds = useMemo(() => {
    if (!contractFilter || !contractScope) return null;
    return new Set(
      contractScope.items
        .filter((si) => si.assignedContractorIds.includes(contractFilter.contractorId))
        .map((si) => si.itemId),
    );
  }, [contractFilter, contractScope]);

  // Локационный отбор раздела (корпус/этажи/тип) — своё состояние, не связано со страницей «Смета».
  const {
    value: locFilter,
    onChange: onLocFilterChange,
    clear: clearLocFilter,
    typeOptions: locTypeOptions,
    filterItems: filterByLocation,
  } = useContractorLocationFilter(items);

  const visibleItems = useMemo(() => {
    let res = onlyUnassigned ? items.filter((it) => (it.item_contractors ?? []).length === 0) : items;
    // Пока состав договора не загрузился, показывать всю смету нельзя: пользователь просил
    // строки одного договора и принял бы полный список за результат отбора.
    if (contractFilter) res = contractItemIds ? res.filter((it) => contractItemIds.has(it.id)) : [];
    if (filterContractorIds.length)
      res = res.filter((it) =>
        (it.item_contractors ?? []).some((c) => filterContractorIds.includes(c.contractor_id)),
      );
    return filterByLocation(res);
  }, [items, onlyUnassigned, contractFilter, contractItemIds, filterContractorIds, filterByLocation]);
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

  const typeKey = (g: CostTypeGroup) => g.costTypeId ?? NO_CATEGORY;

  const toggleCat = (id: string) =>
    setCollapsedCats((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
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
  const expandAll = useCallback(() => {
    setCollapsedCats(new Set());
    setCollapsedTypes(new Set());
  }, []);
  const collapseAll = () => {
    setCollapsedCats(new Set(groups.map((g) => g.costCategoryId ?? NO_CATEGORY)));
    setCollapsedTypes(new Set(groups.map(typeKey)));
  };

  // Вход на вкладку: категории и виды работ видны, наименования работ свёрнуты — как на «Смете».
  // Переход «строки договора» из реестра ВОР исключение: там пришли смотреть именно строки.
  const allTypeKeys = useMemo(() => groups.map((g) => g.costTypeId ?? NO_CATEGORY), [groups]);
  useInitialCollapsedTypes({
    estimateId,
    typeKeys: allTypeKeys,
    enabled: !contractFilter,
    onCollapse: setCollapsedTypes,
  });
  const contractVorId = contractFilter?.vorId ?? null;
  const contractContractorId = contractFilter?.contractorId ?? null;
  useEffect(() => {
    if (contractVorId) expandAll();
  }, [contractVorId, contractContractorId, expandAll]);

  // Сумма по набору видов работ (работы + их материалы) — по договорным ценам, как и столбцы.
  const groupsTotal = (gs: CostTypeGroup[]) =>
    gs.reduce((acc, g) => acc + sumWorksTotal(g.works, 'contract'), 0);

  // Ячейка «Исполнитель». Только показ: назначают и снимают подрядчика в реестре «ВОР объекта».
  const renderExecutor = (it: EstimateItem) => {
    const lockedIds = it.request_locked_contractor_ids ?? [];
    const chips = (it.item_contractors ?? []).map((c) => {
      // По строке уже заказаны материалы у этого подрядчика — снятие через ВОР её пропустит.
      const locked = lockedIds.includes(c.contractor_id);
      return (
        <Tooltip
          key={c.contractor_id}
          title={locked ? 'По этой строке оформлена заявка на материалы — исполнителя не снять' : undefined}
        >
          <Tag color="purple" icon={locked ? <LockOutlined /> : undefined}>
            {c.contractor_name ?? '—'}
          </Tag>
        </Tooltip>
      );
    });
    return (
      <Space size={4} wrap>
        {chips.length > 0 ? chips : <Tag>без подрядчика</Tag>}
      </Space>
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

  // ── Вид подрядчика: только его строки ──
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
              <span style={{ color: 'var(--est-text-tertiary)' }}> · {it.rate_name}</span>
            )}
          </span>
        ),
      },
      { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
      // Работа достаётся исполнителю целиком, поэтому его объём — объём строки.
      { title: 'Кол-во', key: 'quantity', width: 110, align: 'right', render: (_, it) => num(it.quantity) },
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
            Только без подрядчика
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
          {contractFilter && (
            <Tag color="blue" closable onClose={onClearContractFilter} style={{ marginInlineEnd: 0 }}>
              Договор: {contractFilter.contractorName} · ВОР «{contractFilter.vorName}»
            </Tag>
          )}
          <Tooltip title="Развернуть всё">
            <Button type="text" size="small" icon={<DownOutlined />} onClick={expandAll} />
          </Tooltip>
          <Tooltip title="Свернуть всё">
            <Button type="text" size="small" icon={<UpOutlined />} onClick={collapseAll} />
          </Tooltip>
        </Space>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {sections.length === 0 && (
          <Empty
            description={
              contractFilter && contractScopeLoading ? 'Загружаем строки договора…' : 'Строк нет'
            }
          />
        )}
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
                background: 'var(--est-bg-group)',
                border: '1px solid var(--est-border-group)',
                borderRadius: 8,
                userSelect: 'none',
                marginBottom: collapsed ? 0 : 8,
              }}
            >
              <span
                onClick={() => toggleCat(sec.id)}
                style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', color: 'var(--est-text-tertiary)' }}
                title={collapsed ? 'Развернуть' : 'Свернуть'}
              >
                {collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
              </span>
              <strong style={{ fontSize: 13 }}>{sec.name}</strong>
              <span style={{ color: 'var(--est-text-tertiary)', fontSize: 12 }}>Видов работ: {sec.groups.length}</span>
              <span style={{ flex: 1 }} />
              <ContractorTags contractors={contractorsOf(sec.groups.flatMap((g) => g.works))} />
              {showPrices && (
                <span style={{ color: 'var(--est-primary)', fontWeight: 600 }}>{formatMoney(groupsTotal(sec.groups))}</span>
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
                    // estimateId — только чтобы отрисовались шифры РД (условие показа в блоке).
                    estimateId={estimateId}
                    showPrices={showPrices}
                    // В разделе «Подрядчики» цена означает договор, а не расценку справочника:
                    // показываем цены из заполненного ВОР, у неоценённых строк — прочерк.
                    priceMode="contract"
                    vorByItem={vorByItem}
                    onOpenVor={openVorList}
                    leadingColumns={executorColumn}
                    headerRight={<ContractorTags contractors={contractorsOf(group.works)} />}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
