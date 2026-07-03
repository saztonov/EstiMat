import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Empty, Popconfirm, Popover, Select, Space, Tooltip } from 'antd';
import {
  PlusOutlined,
  TableOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
  DownOutlined,
  UpOutlined,
  SwapOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  EnvironmentOutlined,
  MoreOutlined,
  SnippetsOutlined,
  FileExcelOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { SaveWorkPayload, SaveMaterialPayload } from '../components/types';
import { SmetaGroupBlock } from './SmetaGroupBlock';
import { WorkTreeSelect } from '../components/WorkTreeSelect';
import { ReviewUnconfirmedModal } from '../components/ReviewUnconfirmedModal';
import { ReplicateWorksModal, type ReplicateTargets } from '../components/ReplicateWorksModal';
import { LocationFilterPopover } from './LocationFilterPopover';
import { EstimateFilterSettingsPopover } from './EstimateFilterSettingsPopover';
import { EstimateHistoryDrawer } from './EstimateHistoryDrawer';
import type { CostTypeGroup, EstimateItem } from '../components/types';
import { formatMoney } from '../components/types';
import { formatLocationsLabel, parseFloors } from '../components/location';
import { useEstimateSelectionStore } from '../../../store/estimateSelectionStore';
import { useEstimateExpandStore, typeKeyOf } from '../../../store/estimateExpandStore';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { useLocationContextStore } from '../../../store/locationContextStore';
import { useProjectZones } from '../../../hooks/useProjectLocations';
import { useAuthStore } from '../../../store/authStore';
import { PanelShell } from './PanelShell';
import { SmetaActions } from './SmetaActions';
import { api, ApiError } from '../../../services/api';

interface Organization {
  id: string;
  name: string;
  type?: string;
}

// Конфликт единиц измерения из ответа экспорта (code EXPORT_UNIT_CONFLICTS).
interface UnitConflict {
  kind: 'material' | 'work';
  name: string;
  units: string[];
}

// Список конфликтов для модалки: две секции — материалы (БСМ) и работы (БСР).
function UnitConflictList({ conflicts }: { conflicts: UnitConflict[] }) {
  const materials = conflicts.filter((c) => c.kind === 'material');
  const works = conflicts.filter((c) => c.kind === 'work');
  const fmtUnits = (units: string[]) =>
    units.map((u) => (u.trim() === '' ? '(не указана)' : u)).join(', ');
  const section = (title: string, list: UnitConflict[]) =>
    list.length === 0 ? null : (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {list.map((c) => (
            <li key={c.name}>
              «{c.name}»: {fmtUnits(c.units)}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
      <div style={{ marginBottom: 8 }}>
        У одинаковых наименований найдены разные единицы измерения. В справочники БСМ/БСР попадёт
        первая встретившаяся единица.
      </div>
      {section('Материалы', materials)}
      {section('Работы', works)}
    </div>
  );
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
  onBulkAssignLocation: (workIds: string[], locations: AssignLocation[]) => Promise<unknown>;
  onReplicate: (sourceWorkIds: string[], targets: ReplicateTargets) => Promise<void>;
  onSetContractor: (costTypeId: string, contractorId: string) => void;
  onClearContractor: (costTypeId: string) => void;
}

// Режим выбора в шапке: перенос материалов, массовое удаление, тиражирование набора
// или назначение местоположения выбранным работам.
type SelectionMode = 'none' | 'reassign' | 'copy' | 'delete' | 'replicate' | 'assignloc';

// Снапшот местоположения для массового назначения (фиксируется на старте режима assignloc).
type AssignLocation = { zoneId: string | null; floors: number[] };

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
  const { message, modal } = App.useApp();
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [onlyUnreconciled, setOnlyUnreconciled] = useState(false);
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
  // Единый режим выбора с чекбоксами: перенос ('reassign'), удаление ('delete'),
  // тиражирование ('replicate') или назначение местоположения ('assignloc').
  const [mode, setMode] = useState<SelectionMode>('none');
  // Чекбоксы материалов видны в reassign/copy/delete; в assignloc выбираем только работы.
  const selectionMode = mode !== 'none' && mode !== 'assignloc';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // выбранные материалы (общий набор)
  const [selectedWorkIds, setSelectedWorkIds] = useState<Set<string>>(new Set()); // выбранные работы (delete/replicate/assignloc)
  const [reassigning, setReassigning] = useState(false);
  const [copying, setCopying] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false); // поповер «Действия» в шапке
  const [deleting, setDeleting] = useState(false);
  const [replicateOpen, setReplicateOpen] = useState(false);
  const [replicating, setReplicating] = useState(false);
  // Назначение местоположения выбранным работам: снапшот локации + флаг выполнения.
  const [assignLoc, setAssignLoc] = useState<AssignLocation | null>(null);
  const [assigning, setAssigning] = useState(false);

  // Местоположение: фильтр-срезы + справочник зон для размножения.
  const filterZoneIds = useLocationContextStore((s) => s.filterZoneIds);
  const filterFloorsText = useLocationContextStore((s) => s.filterFloorsText);
  const filterLocationTypeIds = useLocationContextStore((s) => s.filterLocationTypeIds);
  const filterVolumeType = useLocationContextStore((s) => s.filterVolumeType);
  const { data: zonesData } = useProjectZones(projectId);
  // Модалка ревью несогласованных позиций (согласовать/удалить выделенное).
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewConfirming, setReviewConfirming] = useState(false);
  const [reviewDeleting, setReviewDeleting] = useState(false);

  // Массовые операции разрешены сервером только admin/engineer — кнопки остальным не показываем.
  const role = useAuthStore((s) => s.user?.role);
  const canBulkDelete = editable && (role === 'admin' || role === 'engineer');
  // Перенос/копирование материалов (reassign-bulk / copy-bulk) — те же права, отдельное имя по смыслу.
  const canBulkMutateMaterials = canBulkDelete;

  const toggleMaterial = useCallback((id: string, selected: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    }), []);

  const toggleWork = useCallback((id: string, selected: boolean) =>
    setSelectedWorkIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    }), []);

  const cancelSelection = () => {
    setSelectedIds(new Set());
    setSelectedWorkIds(new Set());
    setAssignLoc(null);
    setMode('none');
  };

  // Старт режима назначения местоположения: снапшот локации из поповера, чистый выбор работ.
  const startAssignLocation = (loc: AssignLocation) => {
    setAssignLoc(loc);
    setSelectedIds(new Set());
    setSelectedWorkIds(new Set());
    setMode('assignloc');
  };

  // Назначение снапшота локации выбранным работам. Выделение сбрасываем только после успеха.
  const handleBulkAssign = async () => {
    if (!assignLoc || selectedWorkIds.size === 0 || assigning) return;
    setAssigning(true);
    try {
      await onBulkAssignLocation([...selectedWorkIds], [assignLoc]);
      setSelectedWorkIds(new Set());
      setAssignLoc(null);
      setMode('none');
    } catch {
      /* ошибку покажет мутация; выделение сохраняется */
    } finally {
      setAssigning(false);
    }
  };

  // Перенос выбранных материалов к работе. Выделение сбрасываем только после успеха.
  const handleBulkReassign = async (targetItemId: string) => {
    if (selectedIds.size === 0 || reassigning) return;
    setReassigning(true);
    try {
      await onReassignMaterials([...selectedIds], targetItemId);
      setSelectedIds(new Set());
      setMode('none');
    } catch {
      /* ошибку покажет мутация; выделение сохраняется */
    } finally {
      setReassigning(false);
    }
  };

  // Копирование выбранных материалов в работу (источники остаются). Сброс выбора — после успеха.
  const handleBulkCopy = async (targetItemId: string) => {
    if (selectedIds.size === 0 || copying) return;
    setCopying(true);
    try {
      await onCopyMaterials([...selectedIds], targetItemId);
      setSelectedIds(new Set());
      setMode('none');
    } catch {
      /* ошибку покажет мутация; выделение сохраняется */
    } finally {
      setCopying(false);
    }
  };
  const selectCategory = useEstimateSelectionStore((s) => s.selectCategory);
  const selectWork = useEstimateSelectionStore((s) => s.selectWork);
  const activeCostCategoryId = useEstimateSelectionStore((s) => s.activeCostCategoryId);
  const revealInRatesTree = useEstimateSelectionStore((s) => s.revealInRatesTree);
  const estimateReveal = useEstimateSelectionStore((s) => s.estimateRevealRequest);
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

  // Опции отбора по произвольному «типу» строки — из самих работ (показываем только присутствующие).
  const locationTypeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups)
      for (const w of g.works)
        if (w.location_type_id) m.set(w.location_type_id, w.location_type_name ?? '—');
    return [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [groups]);

  // Набор этажей фильтра из сырого текста («2-4, 6, 11-18»).
  const filterFloors = useMemo(() => parseFloors(filterFloorsText), [filterFloorsText]);

  const locationActive =
    filterZoneIds.length > 0 ||
    filterFloors.length > 0 ||
    filterLocationTypeIds.length > 0 ||
    filterVolumeType !== 'all';

  // Проходит ли работа фильтр локации (срезы по зоне/набору этажей/типу/объёму). Мультизона:
  // достаточно совпадения хотя бы одной зоны и пересечения хотя бы одного этажа.
  const matchesLocation = (w: EstimateItem): boolean => {
    const locs = w.locations ?? [];
    const zoneIds = locs.length
      ? locs.map((l) => l.zoneId).filter((z): z is string => !!z)
      : w.zone_id ? [w.zone_id] : [];
    if (filterZoneIds.length && !zoneIds.some((z) => filterZoneIds.includes(z))) return false;
    if (filterFloors.length) {
      let floors: number[];
      if (locs.length) {
        floors = locs.flatMap((l) => l.floors ?? []);
      } else {
        floors = [];
        const f = w.floor_from ?? null;
        const t = w.floor_to ?? null;
        if (f != null && t != null) { for (let x = f; x <= t; x++) floors.push(x); }
        else if (f != null) floors.push(f);
        else if (t != null) floors.push(t);
      }
      if (floors.length === 0) return false; // нет этажей — не проходит этажный срез
      const sel = new Set(filterFloors);
      if (!floors.some((x) => sel.has(x))) return false; // нет пересечения
    }
    if (filterLocationTypeIds.length && !(w.location_type_id && filterLocationTypeIds.includes(w.location_type_id)))
      return false;
    if (filterVolumeType !== 'all' && (w.volume_type ?? 'main') !== filterVolumeType) return false;
    return true;
  };

  const visibleGroups = useMemo(() => {
    const byFilter = groups.filter(
      (g) =>
        (!categoryFilter || g.costCategoryId === categoryFilter) &&
        (!typeFilter || g.costTypeId === typeFilter),
    );
    if (!onlyUnreconciled && !locationActive) return byFilter;
    // Фильтр на уровне работ: несогласованные и/или срез по локации.
    return byFilter
      .map((g) => ({
        ...g,
        works: g.works.filter(
          (w) => (!onlyUnreconciled || !!w.needs_review) && (!locationActive || matchesLocation(w)),
        ),
      }))
      .filter((g) => g.works.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, categoryFilter, typeFilter, onlyUnreconciled, filterZoneIds, filterFloors, filterLocationTypeIds, filterVolumeType]);

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

  // Поэтапное сворачивание/разворачивание дерева сметы. Уровни (снаружи внутрь):
  // категории → виды работ → работы → материалы. Каждое нажатие двигает на один уровень,
  // ориентируясь на текущее состояние (без счётчика — устойчиво к ручным кликам по строкам).
  const allCatKeys = useMemo(() => groups.map((g) => g.costCategoryId ?? NO_CATEGORY), [groups]);
  const allTypeKeys = useMemo(() => groups.map((g) => typeKeyOf(g.costTypeId)), [groups]);
  const workIdsWithMaterials = useMemo(
    () => groups.flatMap((g) => g.works.filter((w) => (w.materials?.length ?? 0) > 0).map((w) => w.id)),
    [groups],
  );

  // Состояние раскрытия/свёрнутости видов читаем императивно из store (getState), а не подпиской —
  // иначе одиночный разворот работы снова ререндерил бы весь SmetaPanel. Массовую установку
  // раскрытых работ деферим через startTransition: клик отзывается мгновенно, а монтаж/демонтаж
  // материалов идёт прерываемой работой (плюс ленивый рендер не монтирует невидимые таблицы).
  const collapseStep = useCallback(() => {
    const st = useEstimateExpandStore.getState();
    if (workIdsWithMaterials.some((id) => st.expandedWorkIds.has(id))) {
      startTransition(() => st.setExpandedWorkIds(new Set()));
    } else if (allTypeKeys.some((k) => !st.collapsedTypes.has(k))) {
      st.setCollapsedTypes(new Set(allTypeKeys));
    } else if (allCatKeys.some((k) => !collapsedCats.has(k))) {
      setCollapsedCats(new Set(allCatKeys));
    }
  }, [workIdsWithMaterials, allTypeKeys, allCatKeys, collapsedCats]);

  const expandStep = useCallback(() => {
    const st = useEstimateExpandStore.getState();
    if (allCatKeys.some((k) => collapsedCats.has(k))) {
      setCollapsedCats(new Set());
    } else if (allTypeKeys.some((k) => st.collapsedTypes.has(k))) {
      st.setCollapsedTypes(new Set());
    } else if (workIdsWithMaterials.some((id) => !st.expandedWorkIds.has(id))) {
      startTransition(() => st.setExpandedWorkIds(new Set(workIdsWithMaterials)));
    }
  }, [allCatKeys, allTypeKeys, workIdsWithMaterials, collapsedCats]);

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

  // Число строк-листьев в модалке ревью: несогласованная работа = 1 (её материалы уйдут каскадом),
  // иначе считаем несогласованные материалы под согласованной работой.
  const rejectableCount = useMemo(() => {
    let n = 0;
    for (const g of groups)
      for (const w of g.works) {
        if (w.needs_review) n++;
        else for (const m of w.materials) if (m.needs_review) n++;
      }
    return n;
  }, [groups]);

  // Согласовать выделенное в модалке ревью. Выделение/закрытие — после успеха.
  const handleReviewConfirm = async (workIds: string[], materialIds: string[]) => {
    if (reviewConfirming || reviewDeleting) return;
    setReviewConfirming(true);
    try {
      await onBulkConfirm(workIds, materialIds);
      setReviewOpen(false);
    } catch {
      /* ошибку покажет мутация */
    } finally {
      setReviewConfirming(false);
    }
  };

  // Удалить выделенное в модалке ревью.
  const handleReviewDelete = async (workIds: string[], materialIds: string[]) => {
    if (reviewConfirming || reviewDeleting) return;
    setReviewDeleting(true);
    try {
      await onBulkDelete(workIds, materialIds);
      message.success(`Удалено позиций: ${workIds.length + materialIds.length}`);
      setReviewOpen(false);
    } catch {
      /* ошибку покажет мутация */
    } finally {
      setReviewDeleting(false);
    }
  };

  // Сопоставление материал → работа: для удаления исключаем материалы выбранных работ (уйдут каскадом).
  const materialOwner = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const w of g.works) for (const mat of w.materials) m.set(mat.id, w.id);
    return m;
  }, [groups]);

  const effectiveMaterialIds = useMemo(
    () =>
      [...selectedIds].filter((mid) => {
        const owner = materialOwner.get(mid);
        return !(owner && selectedWorkIds.has(owner));
      }),
    [selectedIds, selectedWorkIds, materialOwner],
  );
  const deleteCount = selectedWorkIds.size + effectiveMaterialIds.length;

  // Удаление выбранных работ (с каскадом материалов) и отдельных материалов. Сброс — только после успеха.
  const handleBulkDelete = async () => {
    if (deleteCount === 0 || deleting) return;
    setDeleting(true);
    try {
      await onBulkDelete([...selectedWorkIds], effectiveMaterialIds);
      message.success(`Удалено: работ ${selectedWorkIds.size}, материалов ${effectiveMaterialIds.length}`);
      setSelectedIds(new Set());
      setSelectedWorkIds(new Set());
      setMode('none');
    } catch {
      /* ошибку покажет мутация; выделение сохраняется */
    } finally {
      setDeleting(false);
    }
  };

  // Смена фильтра не должна оставлять выбранными скрытые строки — иначе можно удалить/перенести невидимое.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectedWorkIds(new Set());
  }, [categoryFilter, typeFilter, onlyUnreconciled, filterZoneIds, filterFloorsText, filterLocationTypeIds, filterVolumeType]);

  // Выбранные работы-шаблоны для тиражирования (по id из всех групп).
  const selectedSourceWorks = useMemo(() => {
    if (selectedWorkIds.size === 0) return [];
    const out: EstimateItem[] = [];
    for (const g of groups) for (const w of g.works) if (selectedWorkIds.has(w.id)) out.push(w);
    return out;
  }, [groups, selectedWorkIds]);

  // Тиражирование выбранного набора на целевые локации. Сброс — только после успеха.
  const handleReplicate = async (targets: ReplicateTargets) => {
    if (selectedWorkIds.size === 0 || replicating) return;
    setReplicating(true);
    try {
      await onReplicate([...selectedWorkIds], targets);
      setReplicateOpen(false);
      setSelectedWorkIds(new Set());
      setMode('none');
    } catch {
      /* ошибку покажет мутация; выделение сохраняется */
    } finally {
      setReplicating(false);
    }
  };

  // Навигация к работе из ИИ-чата: раскрыть категорию/вид, снять фильтры, выделить и прокрутить.
  useEffect(() => {
    if (!estimateReveal) return;
    const id = estimateReveal.itemId;
    let target: { g: CostTypeGroup; description: string } | null = null;
    for (const g of groups) {
      const w = g.works.find((x) => x.id === id);
      if (w) { target = { g, description: w.description }; break; }
    }
    if (!target) return;
    const catKey = target.g.costCategoryId ?? NO_CATEGORY;
    const tKey = target.g.costTypeId ?? NO_CATEGORY;
    setCategoryFilter(undefined);
    setTypeFilter(undefined);
    setOnlyUnreconciled(false);
    // Снимаем и локационный фильтр — иначе скрытая им строка не отрисуется и scrollIntoView не сработает.
    useLocationContextStore.getState().clearFilter();
    setCollapsedCats((prev) => { if (!prev.has(catKey)) return prev; const n = new Set(prev); n.delete(catKey); return n; });
    useEstimateExpandStore.getState().expandType(tKey);
    selectWork(id, target.description, {
      costTypeId: target.g.costTypeId,
      costTypeName: target.g.costTypeName,
      costCategoryId: target.g.costCategoryId,
      costCategoryName: target.g.costCategoryName,
    });
    const scrollToRow = () =>
      document.querySelector('.estimat-row-selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => {
      scrollToRow();
      // Повторный проход после кадра: высоты ленивых placeholder’ов материалов могли сместить позицию.
      requestAnimationFrame(scrollToRow);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateReveal?.nonce]);

  // Стабильный объект зон — общий root-список для блоков и фильтров (вместо []-литерала каждый рендер).
  const zoneRoots = useMemo(() => zonesData?.data.roots ?? [], [zonesData]);
  // Чекбоксы работ активны в delete и replicate (выбор шаблона для тиражирования).
  const deleteModeFlag = mode === 'delete' || mode === 'replicate' || mode === 'assignloc';

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
      canReorderWorks: true,
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
      onOpenHistory: openRowHistory,
    }),
    [
      editable, orgs, onCreateWork, onUpdateWork, onDeleteWork, onReorderWorks,
      onCreateMaterial, onUpdateMaterial, onDeleteMaterial, onConfirmMaterial, onConfirmWork,
      onToggleVolumeType, onReassignMaterial, allWorks, onSetContractor, onClearContractor, selectionMode, selectedIds,
      toggleMaterial, deleteModeFlag, selectedWorkIds, toggleWork, zoneRoots, projectId, openRowHistory,
    ],
  );

  // Экспорт в Excel-шаблон «КП»: выгружаем ровно те работы, что видны после фильтров.
  // Метку локации формируем тем же formatLocationsLabel, что и остальной UI (единый
  // источник форматирования); порядок и группировку по локации доделывает сервер.
  // Листы БСМ/БСР (уникальные материалы/работы) собирает сервер из того же набора строк;
  // при разных ед.изм. у одинаковых наименований он отвечает 409 с code EXPORT_UNIT_CONFLICTS —
  // показываем модалку с выбором «Пропустить и сохранить» (повтор с ignoreUnitConflicts) / «Отмена».
  const [exporting, setExporting] = useState(false);
  const runExport = useCallback(
    async (ignoreUnitConflicts?: boolean) => {
      const items = visibleGroups
        .flatMap((g) => g.works)
        .map((w) => ({
          id: w.id,
          locationLabel: formatLocationsLabel(w.locations ?? [], zoneRoots) || 'Без локации',
        }));
      if (items.length === 0) {
        message.info('Нет строк для экспорта — измените фильтры.');
        return;
      }
      setExporting(true);
      try {
        await api.download(
          `/estimates/${estimateId}/export-kp`,
          { items, ignoreUnitConflicts },
          'КП.xlsx',
        );
      } catch (e) {
        if (e instanceof ApiError && e.code === 'EXPORT_UNIT_CONFLICTS') {
          const conflicts = (e.data as { conflicts?: UnitConflict[] } | undefined)?.conflicts ?? [];
          modal.confirm({
            title: 'Разные единицы измерения',
            width: 560,
            icon: <ExclamationCircleOutlined />,
            content: <UnitConflictList conflicts={conflicts} />,
            okText: 'Пропустить и сохранить',
            cancelText: 'Отмена',
            onOk: () => runExport(true),
          });
          return;
        }
        message.error(e instanceof Error ? e.message : 'Не удалось выгрузить файл');
      } finally {
        setExporting(false);
      }
    },
    [visibleGroups, zoneRoots, estimateId, message, modal],
  );
  const handleExportKp = useCallback(() => runExport(), [runExport]);

  return (
    <PanelShell
      bodyRef={scrollRootRef}
      icon={<TableOutlined />}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Сметная часть
          <SmetaActions estimateId={estimateId} projectId={projectId} />
        </span>
      }
      extra={
        groups.length > 0 ? (
          <Space size={2} style={{ marginLeft: 'auto' }}>
            {editable && mode === 'reassign' && (
              <Space size={6} style={{ marginRight: 4 }}>
                <span style={{ fontSize: 12.5, color: '#595959' }}>Выбрано: {selectedIds.size}</span>
                <Popover
                  trigger="click"
                  title="Перенести материалы к работе"
                  content={
                    <WorkTreeSelect works={allWorks} disabled={reassigning} onPick={handleBulkReassign} />
                  }
                >
                  <Button
                    type="primary"
                    size="small"
                    icon={<SwapOutlined />}
                    disabled={selectedIds.size === 0 || reassigning}
                    loading={reassigning}
                  >
                    Перенести
                  </Button>
                </Popover>
                <Button size="small" disabled={reassigning} onClick={cancelSelection}>
                  Отмена
                </Button>
              </Space>
            )}
            {editable && mode === 'copy' && (
              <Space size={6} style={{ marginRight: 4 }}>
                <span style={{ fontSize: 12.5, color: '#595959' }}>Выбрано: {selectedIds.size}</span>
                <Popover
                  trigger="click"
                  title="Копировать материалы в работу"
                  content={
                    <WorkTreeSelect works={allWorks} disabled={copying} onPick={handleBulkCopy} />
                  }
                >
                  <Button
                    type="primary"
                    size="small"
                    icon={<SnippetsOutlined />}
                    disabled={selectedIds.size === 0 || copying}
                    loading={copying}
                  >
                    Копировать
                  </Button>
                </Popover>
                <Button size="small" disabled={copying} onClick={cancelSelection}>
                  Отмена
                </Button>
              </Space>
            )}
            {editable && mode === 'delete' && (
              <Space size={6} style={{ marginRight: 4 }}>
                <span style={{ fontSize: 12.5, color: '#595959' }}>Выбрано: {deleteCount}</span>
                <Button
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={deleteCount === 0 || deleting}
                  loading={deleting}
                  onClick={handleBulkDelete}
                >
                  Подтвердить удаление
                </Button>
                <Button size="small" disabled={deleting} onClick={cancelSelection}>
                  Отмена
                </Button>
              </Space>
            )}
            {editable && mode === 'replicate' && (
              <Space size={6} style={{ marginRight: 4 }}>
                <span style={{ fontSize: 12.5, color: '#595959' }}>Шаблон: {selectedWorkIds.size}</span>
                <Button
                  type="primary"
                  size="small"
                  icon={<CopyOutlined />}
                  disabled={selectedWorkIds.size === 0}
                  onClick={() => setReplicateOpen(true)}
                >
                  Копировать работы
                </Button>
                <Button size="small" onClick={cancelSelection}>Отмена</Button>
              </Space>
            )}
            {editable && mode === 'assignloc' && (
              <Space size={6} style={{ marginRight: 4 }}>
                <span style={{ fontSize: 12.5, color: '#595959' }}>
                  Локация: {formatLocationsLabel([{ zoneId: assignLoc?.zoneId ?? null, floors: assignLoc?.floors ?? [] }], zonesData?.data.roots ?? []) || '—'}
                  {' · '}Выбрано: {selectedWorkIds.size}
                </span>
                <Popconfirm
                  title="Назначить местоположение"
                  description="Перезаписать местоположение у выбранных работ?"
                  okText="Назначить"
                  cancelText="Отмена"
                  disabled={selectedWorkIds.size === 0 || assigning}
                  onConfirm={handleBulkAssign}
                >
                  <Button
                    type="primary"
                    size="small"
                    icon={<EnvironmentOutlined />}
                    disabled={selectedWorkIds.size === 0 || assigning}
                    loading={assigning}
                  >
                    Назначить {selectedWorkIds.size} работам
                  </Button>
                </Popconfirm>
                <Button size="small" disabled={assigning} onClick={cancelSelection}>Отмена</Button>
              </Space>
            )}
            {mode === 'none' && (
              <Tooltip title="Выгрузить отобранные фильтрами строки в Excel-шаблон ВОР (КП)">
                <Button
                  type="text"
                  size="small"
                  icon={<FileExcelOutlined />}
                  loading={exporting}
                  onClick={handleExportKp}
                >
                  Экспорт в Excel
                </Button>
              </Tooltip>
            )}
            {editable && mode === 'none' && (canBulkMutateMaterials || canBulkDelete) && (
              <Popover
                trigger="click"
                placement="bottomRight"
                open={actionsOpen}
                onOpenChange={setActionsOpen}
                content={
                  <Space direction="vertical" size={2} style={{ minWidth: 210 }}>
                    {canBulkDelete && rejectableCount > 0 && (
                      <Button
                        type="text"
                        size="small"
                        icon={<CheckCircleOutlined />}
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                        onClick={() => { setActionsOpen(false); setReviewOpen(true); }}
                      >
                        Несогласованные ({rejectableCount})
                      </Button>
                    )}
                    {canBulkMutateMaterials && (
                      <Button
                        type="text"
                        size="small"
                        icon={<SwapOutlined />}
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                        onClick={() => { setActionsOpen(false); setMode('reassign'); }}
                      >
                        Перенос материалов
                      </Button>
                    )}
                    {canBulkMutateMaterials && (
                      <Button
                        type="text"
                        size="small"
                        icon={<SnippetsOutlined />}
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                        onClick={() => { setActionsOpen(false); setMode('copy'); }}
                      >
                        Копирование материалов
                      </Button>
                    )}
                    {canBulkDelete && (
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                        onClick={() => { setActionsOpen(false); setMode('replicate'); }}
                      >
                        Копировать работы
                      </Button>
                    )}
                    {canBulkDelete && (
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                        onClick={() => { setActionsOpen(false); setMode('delete'); }}
                      >
                        Удалить несколько
                      </Button>
                    )}
                  </Space>
                }
              >
                <Button type="text" size="small" icon={<MoreOutlined />}>
                  Действия
                </Button>
              </Popover>
            )}
            <Tooltip title="Развернуть на уровень глубже (категории → виды → работы → материалы)">
              <Button type="text" size="small" icon={<DownOutlined />} onClick={expandStep} />
            </Tooltip>
            <Tooltip title="Свернуть на уровень (материалы → работы → виды → категории)">
              <Button type="text" size="small" icon={<UpOutlined />} onClick={collapseStep} />
            </Tooltip>
          </Space>
        ) : undefined
      }
      toolbar={
        groups.length > 0 ? (
          <Space wrap>
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
            <LocationFilterPopover
              zones={zonesData?.data.roots ?? []}
              typeOptions={locationTypeOptions}
              onlyUnreconciled={onlyUnreconciled}
              onUnreconciledChange={setOnlyUnreconciled}
            />
            {editable && (
              <EstimateFilterSettingsPopover
                estimateId={estimateId}
                zones={zonesData?.data.roots ?? []}
                editable={editable}
                onAssignLocation={canBulkDelete ? startAssignLocation : undefined}
              />
            )}
          </Space>
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
                    <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(groupsTotal(sec.groups))}</span>
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
