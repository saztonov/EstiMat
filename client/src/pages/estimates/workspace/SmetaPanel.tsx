import { useMemo, useState } from 'react';
import { Button, Empty, Select, Space, Tooltip } from 'antd';
import {
  PlusOutlined,
  TableOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { CostTypeGroupBlock, type SaveWorkPayload, type SaveMaterialPayload } from '../components/CostTypeGroupBlock';
import type { CostTypeGroup } from '../components/types';
import { formatMoney } from '../components/types';
import { useEstimateSelectionStore } from '../../../store/estimateSelectionStore';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { PanelShell } from './PanelShell';

interface Organization {
  id: string;
  name: string;
  type?: string;
}

interface Props {
  groups: CostTypeGroup[];
  total: string;
  totalItems: number;
  groupCount: number;
  editable: boolean;
  orgs?: Organization[];
  onAddCostType: () => void;
  onCreateWork: (costTypeId: string | null, payload: SaveWorkPayload) => Promise<void>;
  onUpdateWork: (workId: string, payload: SaveWorkPayload) => Promise<void>;
  onDeleteWork: (workId: string) => void;
  onCreateMaterial: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  onUpdateMaterial: (materialId: string, payload: SaveMaterialPayload) => Promise<void>;
  onDeleteMaterial: (materialId: string) => void;
  onSetContractor: (costTypeId: string, contractorId: string) => void;
  onClearContractor: (costTypeId: string) => void;
}

const NO_CATEGORY = '__none__';

// Сумма по набору видов работ (работы + их материалы).
const groupsTotal = (gs: CostTypeGroup[]) =>
  gs.reduce(
    (acc, g) =>
      acc +
      g.works.reduce(
        (a, w) => a + Number(w.total ?? 0) + w.materials.reduce((mm, m) => mm + Number(m.total ?? 0), 0),
        0,
      ),
    0,
  );

export function SmetaPanel({
  groups,
  total,
  totalItems,
  groupCount,
  editable,
  orgs,
  onAddCostType,
  onCreateWork,
  onUpdateWork,
  onDeleteWork,
  onCreateMaterial,
  onUpdateMaterial,
  onDeleteMaterial,
  onSetContractor,
  onClearContractor,
}: Props) {
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const selectCategory = useEstimateSelectionStore((s) => s.selectCategory);
  const activeCostCategoryId = useEstimateSelectionStore((s) => s.activeCostCategoryId);
  const revealInRatesTree = useEstimateSelectionStore((s) => s.revealInRatesTree);
  const showArea = useWorkspaceLayoutStore((s) => s.showArea);
  const openSection = useWorkspaceLayoutStore((s) => s.openSection);

  // Опции отборов — из самих групп (показываем только то, что есть).
  const categoryOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) if (g.costCategoryId) m.set(g.costCategoryId, g.costCategoryName ?? '—');
    return [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [groups]);

  const typeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      if (categoryFilter && g.costCategoryId !== categoryFilter) continue;
      if (g.costTypeId) m.set(g.costTypeId, g.costTypeName ?? '—');
    }
    return [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [groups, categoryFilter]);

  const visibleGroups = useMemo(
    () =>
      groups.filter(
        (g) =>
          (!categoryFilter || g.costCategoryId === categoryFilter) &&
          (!typeFilter || g.costTypeId === typeFilter),
      ),
    [groups, categoryFilter, typeFilter],
  );

  // Группировка видимых видов работ по категориям (порядок — как пришли,
  // groups уже отсортированы по категории→виду).
  const sections = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { id: string; name: string; groups: CostTypeGroup[] }>();
    for (const g of visibleGroups) {
      const key = g.costCategoryId ?? NO_CATEGORY;
      if (!map.has(key)) {
        map.set(key, { id: key, name: g.costCategoryName ?? 'Без категории', groups: [] });
        order.push(key);
      }
      map.get(key)!.groups.push(g);
    }
    return order.map((k) => map.get(k)!);
  }, [visibleGroups]);

  const toggleCat = (id: string) =>
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const typeKey = (g: CostTypeGroup) => g.costTypeId ?? NO_CATEGORY;
  const toggleType = (id: string | null) =>
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      const k = id ?? NO_CATEGORY;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Развернуть/свернуть всё дерево сметы (категории + виды работ).
  const expandAll = () => {
    setCollapsedCats(new Set());
    setCollapsedTypes(new Set());
  };
  const collapseAll = () => {
    setCollapsedCats(new Set(groups.map((g) => g.costCategoryId ?? NO_CATEGORY)));
    setCollapsedTypes(new Set(groups.map(typeKey)));
  };

  const blockProps = {
    editable,
    orgs,
    collapsible: true,
    showCategoryInTitle: false,
    onCreateWork,
    onUpdateWork,
    onDeleteWork,
    onCreateMaterial,
    onUpdateMaterial,
    onDeleteMaterial,
    onSetContractor,
    onClearContractor,
  };

  return (
    <PanelShell
      icon={<TableOutlined />}
      title="Сметная часть"
      meta={
        <>
          Работ: {totalItems} · Видов работ: {groupCount} ·{' '}
          <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(total)}</span>
        </>
      }
      extra={
        groups.length > 0 ? (
          <Space size={2} style={{ marginLeft: 8 }}>
            <Tooltip title="Развернуть всё">
              <Button type="text" size="small" icon={<DownOutlined />} onClick={expandAll} />
            </Tooltip>
            <Tooltip title="Свернуть всё">
              <Button type="text" size="small" icon={<UpOutlined />} onClick={collapseAll} />
            </Tooltip>
          </Space>
        ) : undefined
      }
    >
      {groups.length > 0 ? (
        <>
          <Space style={{ marginBottom: 12 }} wrap>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Категория"
              value={categoryFilter}
              onChange={(v) => {
                setCategoryFilter(v);
                setTypeFilter(undefined);
              }}
              options={categoryOptions}
              style={{ width: 240 }}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Вид работ"
              value={typeFilter}
              onChange={setTypeFilter}
              options={typeOptions}
              style={{ width: 240 }}
            />
          </Space>

          {sections.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ничего не найдено по отбору" style={{ padding: '24px 0' }} />
          ) : (
            sections.map((sec) => {
              const collapsed = collapsedCats.has(sec.id);
              return (
                <div key={sec.id} style={{ marginBottom: 16 }}>
                  <div
                    className={sec.id !== NO_CATEGORY && sec.id === activeCostCategoryId ? 'estimat-cat-active' : undefined}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('.estimat-caret')) return;
                      if (sec.id !== NO_CATEGORY) selectCategory(sec.id, sec.name);
                    }}
                    onDoubleClick={(e) => {
                      if ((e.target as HTMLElement).closest('.estimat-caret')) return;
                      if (sec.id === NO_CATEGORY) return;
                      showArea('refs');
                      openSection('works');
                      revealInRatesTree(sec.id);
                    }}
                    title={sec.id !== NO_CATEGORY ? 'Клик — выделить категорию; двойной клик — показать в справочнике' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      background: '#eef2f7',
                      border: '1px solid #e0e6ee',
                      borderRadius: 8,
                      cursor: sec.id !== NO_CATEGORY ? 'pointer' : 'default',
                      userSelect: 'none',
                      marginBottom: collapsed ? 0 : 12,
                    }}
                  >
                    <span
                      className="estimat-caret"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCat(sec.id);
                      }}
                      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', color: '#8c8c8c' }}
                      title={collapsed ? 'Развернуть' : 'Свернуть'}
                    >
                      {collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
                    </span>
                    <strong style={{ fontSize: 15 }}>{sec.name}</strong>
                    <span style={{ color: '#8c8c8c', fontSize: 12 }}>Видов работ: {sec.groups.length}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(groupsTotal(sec.groups))}</span>
                  </div>

                  {!collapsed && (
                    <div style={{ paddingLeft: 12 }}>
                      {sec.groups.map((group, i) => (
                        <CostTypeGroupBlock
                          key={group.costTypeId ?? '__none__'}
                          group={group}
                          index={i}
                          collapsed={collapsedTypes.has(typeKey(group))}
                          onToggleCollapsed={() => toggleType(group.costTypeId)}
                          {...blockProps}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {editable && (
            <Button type="dashed" icon={<PlusOutlined />} onClick={onAddCostType} style={{ width: '100%' }}>
              Добавить вид работ
            </Button>
          )}
        </>
      ) : (
        <Empty description="В смете пока нет работ. Добавьте вид работ или перенесите работу из справочника двойным кликом." style={{ padding: '40px 0' }}>
          {editable && (
            <Button type="primary" icon={<PlusOutlined />} onClick={onAddCostType}>
              Добавить вид работ
            </Button>
          )}
        </Empty>
      )}
    </PanelShell>
  );
}
