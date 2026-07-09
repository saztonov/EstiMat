import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Empty, Popover, Select, Space, Tooltip } from 'antd';
import { PlusOutlined, TableOutlined, CaretRightOutlined, CaretDownOutlined, FilterOutlined } from '@ant-design/icons';
import type { SaveWorkPayload, SaveMaterialPayload } from '../components/types';
import { SmetaGroupBlock } from './SmetaGroupBlock';
import { ReviewUnconfirmedModal } from '../components/ReviewUnconfirmedModal';
import { ReplicateWorksModal, type ReplicateTargets } from '../components/ReplicateWorksModal';
import { LocationFilterPopover } from './LocationFilterPopover';
import { EstimateFilterSettingsPopover } from './EstimateFilterSettingsPopover';
import { ColumnSettingsPopover } from './ColumnSettingsPopover';
import { useSmetaColumnsStore, resolveColumnPrefs, PHONE_HIDDEN_DEFAULTS } from '../../../store/smetaColumnsStore';
import { useIsMobile, useIsPhone } from '../../../hooks/useMediaQuery';
import { EstimateHistoryDrawer } from './EstimateHistoryDrawer';
import type { CostTypeGroup, EstimateItem } from '../components/types';
import { formatMoney } from '../components/types';
import { useSmetaFilters, NO_CATEGORY } from './useSmetaFilters';
import { useSmetaSelection, type AssignLocation } from './useSmetaSelection';
import { useExpandSteps } from './useExpandSteps';
import { useEstimateReveal } from './useEstimateReveal';
import { SmetaSelectionToolbar } from './SmetaSelectionToolbar';
import { useEstimateSelectionStore } from '../../../store/estimateSelectionStore';
import { useEstimateExpandStore } from '../../../store/estimateExpandStore';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { useProjectZones } from '../../../hooks/useProjectLocations';
import { useAuthStore } from '../../../store/authStore';
import { PanelShell } from './PanelShell';
import { SmetaActions } from './SmetaActions';
import { UndoButton } from './UndoButton';
import { useEstimateExport } from './useEstimateExport';

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
  estimateId: string;
  projectId: string;
  onAddCostType: () => void;
  onCreateWork: (costTypeId: string | null, payload: SaveWorkPayload) => Promise<void>;
  onUpdateWork: (workId: string, payload: SaveWorkPayload) => Promise<void>;
  onDeleteWork: (workId: string) => void;
  onReorderWorks: (orderedIds: string[]) => void;
  onCreateMaterial: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  onUpdateMaterial: (materialId: string, payload: SaveMaterialPayload) => Promise<void>;
  onDeleteMaterial: (materialId: string) => void;
  onConfirmMaterial: (materialId: string) => void;
  onConfirmWork: (workId: string) => void;
  onToggleVolumeType: (itemId: string, current: 'main' | 'additional') => void;
  onBulkConfirm: (workIds: string[], materialIds: string[]) => Promise<void>;
  onReassignMaterial: (materialId: string, itemId: string) => void;
  onReassignMaterials: (materialIds: string[], itemId: string) => Promise<void>;
  onCopyMaterials: (materialIds: string[], itemId: string) => Promise<void>;
  onBulkDelete: (workIds: string[], materialIds: string[]) => Promise<unknown>;
  onBulkAssignLocation: (workIds: string[], assign: AssignLocation) => Promise<unknown>;
  onReplicate: (sourceWorkIds: string[], targets: ReplicateTargets) => Promise<void>;
  onSetContractor: (costTypeId: string, contractorId: string) => void;
  onClearContractor: (costTypeId: string) => void;
}

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
  editable,
  orgs,
  estimateId,
  projectId,
  onAddCostType,
  onCreateWork,
  onUpdateWork,
  onDeleteWork,
  onReorderWorks,
  onCreateMaterial,
  onUpdateMaterial,
  onDeleteMaterial,
  onConfirmMaterial,
  onConfirmWork,
  onToggleVolumeType,
  onBulkConfirm,
  onReassignMaterial,
  onReassignMaterials,
  onCopyMaterials,
  onBulkDelete,
  onBulkAssignLocation,
  onReplicate,
  onSetContractor,
  onClearContractor,
}: Props) {
  // Фильтры (категория/вид/несогласованные + локационный срез) и производные: опции, видимые группы, секции.
  const {
    categoryFilter, setCategoryFilter,
    typeFilter, setTypeFilter,
    onlyUnreconciled, setOnlyUnreconciled,
    categoryOptions, typeOptions, locationTypeOptions,
    filterZoneIds, filterFloorsText, filterLocationTypeIds, filterVolumeType,
    visibleGroups, sections,
  } = useSmetaFilters(groups);
  // collapsedCats оставлен в локальном state: категорий мало, и их свёртка реально
  // меняет видимую структуру (рендер секций здесь). Это свёртка, не фильтр.
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  // Полная история выбранной строки — один Drawer на всю панель (а не на каждую строку).
  const [historyItem, setHistoryItem] = useState<EstimateItem | null>(null);
  const openRowHistory = useCallback((item: EstimateItem) => setHistoryItem(item), []);
  // Раскрытие работ и свёрнутость видов вынесены в estimateExpandStore: SmetaGroupBlock подписан
  // на свой узкий срез (разворот одной работы не каскадит). SmetaPanel на эти срезы НЕ подписан —
  // читает их в обработчиках через getState(). collapsedCats оставлен в локальном state: категорий
  // мало, и их свёртка реально меняет видимую структуру (рендер секций здесь).
  // Scroll-контейнер сметы — root для IntersectionObserver ленивых материалов в блоках.
  const scrollRootRef = useRef<HTMLDivElement>(null);
  // Сброс раскрытия при смене сметы (глобальный store сам не обнуляется при размонтировании).
  const resetExpand = useEstimateExpandStore((s) => s.reset);
  useEffect(() => {
    resetExpand();
    return resetExpand;
  }, [estimateId, resetExpand]);
  // Режимы выбора и все массовые операции (перенос/копирование/удаление/тиражирование/
  // назначение локации/ревью несогласованных) — в useSmetaSelection.
  const {
    mode, setMode,
    selectionMode, deleteModeFlag,
    selectedIds, selectedWorkIds,
    toggleMaterial, toggleWork, clearSelections, cancelSelection,
    startAssignLocation, assignLoc,
    reassigning, copying, deleting, replicating, assigning,
    replicateOpen, setReplicateOpen,
    reviewOpen, setReviewOpen, reviewConfirming, reviewDeleting,
    rejectableCount, deleteCount, selectedSourceWorks,
    handleBulkAssign, handleBulkReassign, handleBulkCopy, handleBulkDelete,
    handleReplicate, handleReviewConfirm, handleReviewDelete,
  } = useSmetaSelection({
    groups,
    onReassignMaterials,
    onCopyMaterials,
    onBulkDelete,
    onBulkAssignLocation,
    onReplicate,
    onBulkConfirm,
  });
  // Справочник зон объекта (для фильтров, тиражирования и колонки «Местоположение»).
  const { data: zonesData } = useProjectZones(projectId);

  // Массовые операции разрешены сервером только admin/engineer — кнопки остальным не показываем.
  const role = useAuthStore((s) => s.user?.role);
  const canBulkDelete = editable && (role === 'admin' || role === 'engineer');
  // Перенос/копирование материалов (reassign-bulk / copy-bulk) — те же права, отдельное имя по смыслу.
  const canBulkMutateMaterials = canBulkDelete;

  // Адаптивные режимы: <1200px — смета на всю ширину, <768px — телефонные упрощения.
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();

  // Настройки столбцов сметы (порядок/видимость) — подписка здесь, в блоки передаём готовый prefs,
  // чтобы CostTypeGroupBlock (общий с разделом «Подрядчики») не подписывался на store.
  const columnOrder = useSmetaColumnsStore((s) => s.order);
  const columnHidden = useSmetaColumnsStore((s) => s.hidden);
  const columnPrefs = useMemo(
    () => resolveColumnPrefs(columnOrder, columnHidden, isPhone ? PHONE_HIDDEN_DEFAULTS : undefined),
    [columnOrder, columnHidden, isPhone],
  );

  const selectCategory = useEstimateSelectionStore((s) => s.selectCategory);
  const activeCostCategoryId = useEstimateSelectionStore((s) => s.activeCostCategoryId);
  const revealInRatesTree = useEstimateSelectionStore((s) => s.revealInRatesTree);
  const showArea = useWorkspaceLayoutStore((s) => s.showArea);
  const openSection = useWorkspaceLayoutStore((s) => s.openSection);

  const toggleCat = (id: string) =>
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Поэтапное сворачивание/разворачивание дерева сметы (категории → виды → работы → материалы).
  const { expandStep, collapseStep } = useExpandSteps({ groups, collapsedCats, setCollapsedCats });

  // Список работ сметы — для выбора цели при переносе материала (дерево Категория → Вид работ → Работа).
  const allWorks = useMemo(
    () =>
      groups.flatMap((g) =>
        g.works
          .filter((w) => w.id)
          .map((w) => ({
            id: w.id,
            label: w.description,
            costTypeId: g.costTypeId,
            costTypeName: g.costTypeName,
            costCategoryId: g.costCategoryId,
            costCategoryName: g.costCategoryName,
          })),
      ),
    [groups],
  );

  // Смена фильтра не должна оставлять выбранными скрытые строки — иначе можно удалить/перенести невидимое.
  useEffect(() => {
    clearSelections();
  }, [categoryFilter, typeFilter, onlyUnreconciled, filterZoneIds, filterFloorsText, filterLocationTypeIds, filterVolumeType, clearSelections]);

  // Навигация к работе из ИИ-чата: раскрыть категорию/вид, снять фильтры, выделить и прокрутить.
  useEstimateReveal({ groups, setCategoryFilter, setTypeFilter, setOnlyUnreconciled, setCollapsedCats });

  // Стабильный объект зон — общий root-список для блоков и фильтров (вместо []-литерала каждый рендер).
  const zoneRoots = useMemo(() => zonesData?.data.roots ?? [], [zonesData]);

  // Суммы по секциям (категориям) предвычисляем разом, чтобы вложенный reduce не гонялся инлайн
  // для каждой секции на каждый ре-рендер панели (ввод фильтра, смена выбора и т.п.).
  const sectionTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const sec of sections) m.set(sec.id, groupsTotal(sec.groups));
    return m;
  }, [sections]);

  // Стабильный (useMemo) набор общих пропсов блоков: пока не меняется выбор/режим, blockProps не
  // пересоздаётся, поэтому memo-обёртки SmetaGroupBlock не ререндерятся при не связанных изменениях.
  // Раскрытие материалов и свёрнутость вида в blockProps НЕ входят — их адаптер берёт из store.
  const blockProps = useMemo(
    () => ({
      editable,
      orgs,
      collapsible: true,
      showCategoryInTitle: false,
      onCreateWork,
      onUpdateWork,
      onDeleteWork,
      onReorderWorks,
      // На телефоне DnD-грип убран: конфликтует с тач-скроллом и съедает ширину.
      canReorderWorks: !isPhone,
      onCreateMaterial,
      onUpdateMaterial,
      onDeleteMaterial,
      onConfirmMaterial,
      onConfirmWork,
      onToggleVolumeType,
      onReassignMaterial,
      allWorks,
      onSetContractor,
      onClearContractor,
      selectionMode,
      selectedIds,
      onToggleMaterial: toggleMaterial,
      deleteMode: deleteModeFlag,
      selectedWorkIds,
      onToggleWork: toggleWork,
      showLocationColumn: true,
      zones: zoneRoots,
      projectId,
      estimateId,
      onOpenHistory: openRowHistory,
      columnPrefs,
      canEditCiphers: canBulkDelete,
      // Мобильный режим: горизонтальный скролл таблицы работ (min-width в px).
      tableScrollX: isMobile ? (isPhone ? 560 : 880) : undefined,
    }),
    [
      editable, orgs, onCreateWork, onUpdateWork, onDeleteWork, onReorderWorks,
      onCreateMaterial, onUpdateMaterial, onDeleteMaterial, onConfirmMaterial, onConfirmWork,
      onToggleVolumeType, onReassignMaterial, allWorks, onSetContractor, onClearContractor, selectionMode, selectedIds,
      toggleMaterial, deleteModeFlag, selectedWorkIds, toggleWork, zoneRoots, projectId, estimateId, openRowHistory,
      columnPrefs, canBulkDelete, isMobile, isPhone,
    ],
  );

  // Экспорт в Excel-шаблон «КП»: выгружаем ровно те работы, что видны после фильтров.
  const { exporting, handleExportKp } = useEstimateExport({ estimateId, visibleGroups, zoneRoots });

  // На мобильном selection-тулбар переезжает из шапки PanelShell в toolbar-строку — в узкой
  // шапке он не помещается вместе с заголовком и SmetaActions.
  const selectionToolbarNode =
    groups.length > 0 ? (
      <SmetaSelectionToolbar
        editable={editable}
        mode={mode}
        allWorks={allWorks}
        zoneRoots={zoneRoots}
        canBulkDelete={canBulkDelete}
        canBulkMutateMaterials={canBulkMutateMaterials}
        selectedMaterialCount={selectedIds.size}
        selectedWorkCount={selectedWorkIds.size}
        deleteCount={deleteCount}
        assignLoc={assignLoc}
        reassigning={reassigning}
        copying={copying}
        deleting={deleting}
        assigning={assigning}
        rejectableCount={rejectableCount}
        exporting={exporting}
        onSetMode={setMode}
        onCancelSelection={cancelSelection}
        onBulkReassign={handleBulkReassign}
        onBulkCopy={handleBulkCopy}
        onBulkDelete={handleBulkDelete}
        onBulkAssign={handleBulkAssign}
        onOpenReplicate={() => setReplicateOpen(true)}
        onOpenReview={() => setReviewOpen(true)}
        onExportKp={handleExportKp}
        onExpandStep={expandStep}
        onCollapseStep={collapseStep}
      />
    ) : undefined;

  // Телефон: фильтры «Категория»/«Вид работ» уходят в поповер «Отбор» (экономия двух строк).
  const activeFilterCount = (categoryFilter?.length ?? 0) + (typeFilter?.length ?? 0);
  const categorySelect = (
    <Select
      mode="multiple"
      allowClear
      showSearch
      optionFilterProp="label"
      maxTagCount="responsive"
      placeholder="Категория"
      value={categoryFilter}
      onChange={setCategoryFilter}
      options={categoryOptions}
      style={{ width: isPhone ? '100%' : isMobile ? 200 : 260 }}
    />
  );
  const typeSelect = (
    <Select
      mode="multiple"
      allowClear
      showSearch
      optionFilterProp="label"
      maxTagCount="responsive"
      placeholder="Вид работ"
      value={typeFilter}
      onChange={setTypeFilter}
      options={typeOptions}
      style={{ width: isPhone ? '100%' : isMobile ? 200 : 260 }}
    />
  );

  return (
    <PanelShell
      bodyRef={scrollRootRef}
      icon={<TableOutlined />}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Сметная часть
          <UndoButton estimateId={estimateId} projectId={projectId} editable={editable} compact={isPhone} />
          <SmetaActions estimateId={estimateId} projectId={projectId} compact={isPhone} />
        </span>
      }
      extra={!isMobile ? selectionToolbarNode : undefined}
      toolbar={
        groups.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {isMobile && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{selectionToolbarNode}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%' }}>
          <Space wrap>
            {isPhone ? (
              <Popover
                trigger="click"
                placement="bottomLeft"
                content={
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 260 }}>
                    {categorySelect}
                    {typeSelect}
                  </div>
                }
              >
                <Badge count={activeFilterCount} size="small" color="#1677ff" offset={[-2, 2]}>
                  <Tooltip title="Отбор по категории и виду работ">
                    <Button icon={<FilterOutlined />} aria-label="Отбор" />
                  </Tooltip>
                </Badge>
              </Popover>
            ) : (
              <>
                {categorySelect}
                {typeSelect}
              </>
            )}
            <LocationFilterPopover
              zones={zonesData?.data.roots ?? []}
              typeOptions={locationTypeOptions}
              onlyUnreconciled={onlyUnreconciled}
              onUnreconciledChange={setOnlyUnreconciled}
            />
            {editable && (
              <EstimateFilterSettingsPopover
                estimateId={estimateId}
                projectId={projectId}
                zones={zonesData?.data.roots ?? []}
                editable={editable}
                onAssignLocation={canBulkDelete ? startAssignLocation : undefined}
              />
            )}
          </Space>
          <div style={{ marginLeft: 'auto' }}>
            <ColumnSettingsPopover />
          </div>
          </div>
          </div>
        ) : undefined
      }
    >
      {groups.length > 0 ? (
        <>

          {sections.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ничего не найдено по отбору" style={{ padding: '24px 0' }} />
          ) : (
            sections.map((sec) => {
              const collapsed = collapsedCats.has(sec.id);
              return (
                <div key={sec.id} style={{ marginBottom: 8 }}>
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
                      gap: 8,
                      padding: '4px 10px',
                      background: '#eef2f7',
                      border: '1px solid #e0e6ee',
                      borderRadius: 8,
                      cursor: sec.id !== NO_CATEGORY ? 'pointer' : 'default',
                      userSelect: 'none',
                      marginBottom: collapsed ? 0 : 8,
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
                    <strong style={{ fontSize: 13 }}>{sec.name}</strong>
                    <span style={{ color: '#8c8c8c', fontSize: 12 }}>Видов работ: {sec.groups.length}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(sectionTotals.get(sec.id) ?? 0)}</span>
                  </div>

                  {!collapsed && (
                    <div style={{ paddingLeft: 8 }}>
                      {sec.groups.map((group, i) => (
                        <SmetaGroupBlock
                          key={group.costTypeId ?? '__none__'}
                          group={group}
                          index={i}
                          blockProps={blockProps}
                          scrollRootRef={scrollRootRef}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
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

      <ReviewUnconfirmedModal
        open={reviewOpen}
        groups={groups}
        confirming={reviewConfirming}
        deleting={reviewDeleting}
        onCancel={() => setReviewOpen(false)}
        onConfirm={handleReviewConfirm}
        onDelete={handleReviewDelete}
      />

      <ReplicateWorksModal
        open={replicateOpen}
        sourceWorks={selectedSourceWorks}
        zones={zonesData?.data.roots ?? []}
        projectId={projectId}
        loading={replicating}
        onCancel={() => setReplicateOpen(false)}
        onConfirm={handleReplicate}
      />

      <EstimateHistoryDrawer
        estimateId={estimateId}
        entityId={historyItem?.id}
        title={historyItem ? `История: ${historyItem.description}` : undefined}
        open={!!historyItem}
        onClose={() => setHistoryItem(null)}
      />
    </PanelShell>
  );
}
