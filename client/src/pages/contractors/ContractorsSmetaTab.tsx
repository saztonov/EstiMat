import { useMemo, useState, type ReactNode } from 'react';
import {
  App,
  Button,
  Checkbox,
  Empty,
  InputNumber,
  Popover,
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
  UpOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Organization } from '@estimat/shared';
import { api, apiFetch } from '../../services/api';
import { CostTypeGroupBlock } from '../estimates/components/CostTypeGroupBlock';
import {
  buildCostTypeGroups,
  formatMoney,
  type CostTypeGroup,
  type EstimateItem,
  type ItemContractor,
} from '../estimates/components/types';
import { formatLocationLabel } from '../estimates/components/location';

interface Props {
  estimateId: string;
  items: EstimateItem[];
  /** Инженер/админ — может назначать; подрядчик — только просмотр своих строк. */
  canAssign: boolean;
  viewerIsContractor: boolean;
  onChanged: () => void;
}

const NO_CATEGORY = '__none__';
const num = (v: string | number | null | undefined) => Number(v ?? 0);

type AssignMode = 'remainder' | 'percent' | 'qty';
// Параметры назначения без itemIds (их подставляет вызывающий: строка или весь вид работ).
type AssignInput =
  | { mode: 'remainder'; contractorId: string }
  | { mode: 'percent'; contractorId: string; percent: number }
  | { mode: 'qty'; contractorId: string; qty: number };

// Подпись подрядчика строки с его объёмом/долей.
function contractorLabel(c: ItemContractor) {
  if (c.assigned_percent != null) return `${c.contractor_name ?? '—'} · ${num(c.assigned_percent)}%`;
  if (c.assigned_qty != null) return `${c.contractor_name ?? '—'} · ${num(c.assigned_qty)}`;
  return `${c.contractor_name ?? '—'} · весь объём`;
}

// Поповер назначения подрядчика (на строку или на весь вид работ).
function AssignPopover({
  contractorOptions,
  onAssign,
  allowQty,
  trigger,
}: {
  contractorOptions: { value: string; label: string }[];
  onAssign: (input: AssignInput) => Promise<unknown>;
  allowQty: boolean;
  trigger: ReactNode;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [contractorId, setContractorId] = useState<string | undefined>();
  const [mode, setMode] = useState<AssignMode>('remainder');
  const [percent, setPercent] = useState(100);
  const [qty, setQty] = useState(0);
  const [busy, setBusy] = useState(false);

  const modeOptions = [
    { value: 'remainder', label: 'Весь остаток' },
    { value: 'percent', label: 'Процент' },
    ...(allowQty ? [{ value: 'qty', label: 'Объём' }] : []),
  ];

  const submit = async () => {
    if (!contractorId) return message.warning('Выберите подрядчика');
    const input: AssignInput =
      mode === 'percent'
        ? { mode, contractorId, percent }
        : mode === 'qty'
          ? { mode, contractorId, qty }
          : { mode: 'remainder', contractorId };
    setBusy(true);
    try {
      await onAssign(input);
      setOpen(false);
      setContractorId(undefined);
    } catch {
      /* ошибку покажет мутация */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      title="Назначить исполнителя"
      content={
        <Space direction="vertical" style={{ width: 260 }} size={8}>
          <Select
            placeholder="Подрядчик"
            style={{ width: '100%' }}
            value={contractorId}
            onChange={setContractorId}
            options={contractorOptions}
            showSearch
            optionFilterProp="label"
          />
          <Select
            style={{ width: '100%' }}
            value={mode}
            onChange={(v) => setMode(v as AssignMode)}
            options={modeOptions}
          />
          {mode === 'percent' && (
            <InputNumber min={0.01} max={100} value={percent} onChange={(v) => setPercent(v ?? 0)} addonAfter="%" style={{ width: '100%' }} />
          )}
          {mode === 'qty' && (
            <InputNumber min={0.01} value={qty} onChange={(v) => setQty(v ?? 0)} placeholder="Объём" style={{ width: '100%' }} />
          )}
          <Space>
            <Button type="primary" size="small" loading={busy} onClick={submit}>
              Назначить
            </Button>
            <Button size="small" onClick={() => setOpen(false)}>
              Отмена
            </Button>
          </Space>
        </Space>
      }
    >
      {trigger}
    </Popover>
  );
}

export function ContractorsSmetaTab({ estimateId, items, canAssign, viewerIsContractor, onChanged }: Props) {
  void estimateId; // estimateId сервер выводит из itemIds — здесь не нужен
  const { message } = App.useApp();
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

  const visibleItems = useMemo(() => {
    let res = onlyUnassigned
      ? items.filter((it) => num(it.remaining_qty ?? it.quantity) > 1e-6)
      : items;
    if (filterContractorIds.length)
      res = res.filter((it) =>
        (it.item_contractors ?? []).some((c) => filterContractorIds.includes(c.contractor_id)),
      );
    return res;
  }, [items, onlyUnassigned, filterContractorIds]);
  const groups = useMemo(() => buildCostTypeGroups(visibleItems, []), [visibleItems]);

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
  const expandAll = () => {
    setCollapsedCats(new Set());
    setCollapsedTypes(new Set());
  };
  const collapseAll = () => {
    setCollapsedCats(new Set(groups.map((g) => g.costCategoryId ?? NO_CATEGORY)));
    setCollapsedTypes(new Set(groups.map(typeKey)));
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
    const chips = (it.item_contractors ?? []).map((c) => (
      <Tag
        color="purple"
        key={c.contractor_id}
        closable={canAssign}
        onClose={(e) => {
          e.preventDefault();
          e.stopPropagation(); // снятие подрядчика «крестиком» не должно открывать поповер
          clearMutation.mutate({ itemIds: [it.id], contractorId: c.contractor_id });
        }}
      >
        {contractorLabel(c)}
      </Tag>
    ));
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
      <AssignPopover
        contractorOptions={contractorOptions}
        allowQty
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

  if (groups.length === 0) {
    return <Empty description="Строк нет" />;
  }

  // ── Вид подрядчика: только его строки с его объёмом (без изменений) ──
  if (viewerIsContractor) {
    const myColumns: ColumnsType<EstimateItem> = [
      {
        title: 'Локация',
        key: 'location',
        width: 200,
        render: (_, it) => formatLocationLabel(it) || <span style={{ color: '#bfbfbf' }}>—</span>,
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
      { title: 'Кол-во', dataIndex: 'quantity', key: 'quantity', width: 90, align: 'right', render: (v) => num(v) },
      { title: 'Мой объём', key: 'my', width: 120, align: 'right', render: (_, it) => num(it.my_effective_qty) },
    ];
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {groups.map((g) => (
          <div key={g.costTypeId ?? '__none__'}>
            <Space style={{ marginBottom: 8 }}>
              <strong>
                {g.costCategoryName ? `${g.costCategoryName} · ` : ''}
                {g.costTypeName ?? 'Без вида работ'}
              </strong>
            </Space>
            <Table<EstimateItem> rowKey="id" size="small" pagination={false} dataSource={g.works} columns={myColumns} />
          </div>
        ))}
        </Space>
      </div>
    );
  }

  // ── Вид инженера/админа: как страница «Смета» + столбец «Исполнитель» слева ──
  return (
    <div className="contractors-smeta" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, marginBottom: 12 }}>
        <Space wrap>
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
          <Tooltip title="Развернуть всё">
            <Button type="text" size="small" icon={<DownOutlined />} onClick={expandAll} />
          </Tooltip>
          <Tooltip title="Свернуть всё">
            <Button type="text" size="small" icon={<UpOutlined />} onClick={collapseAll} />
          </Tooltip>
        </Space>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
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
                    showPrices={showPrices}
                    leadingColumns={executorColumn}
                    headerExtra={
                      canAssign ? (
                        <AssignPopover
                          contractorOptions={contractorOptions}
                          allowQty={false}
                          onAssign={(input) => doAssign(input, group.works.map((w) => w.id))}
                          trigger={
                            <Button type="link" size="small" icon={<UserOutlined />}>
                              на весь вид
                            </Button>
                          }
                        />
                      ) : undefined
                    }
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
