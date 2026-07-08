import { useCallback, useMemo, useState } from 'react';
import { App } from 'antd';
import type { CostTypeGroup, EstimateItem } from '../components/types';
import type { ReplicateTargets } from '../components/ReplicateWorksModal';

// Режим выбора в шапке: перенос материалов, массовое удаление, тиражирование набора
// или назначение местоположения выбранным работам.
export type SelectionMode = 'none' | 'reassign' | 'copy' | 'delete' | 'replicate' | 'assignloc';

// Снапшот параметров (местоположение и/или тип) для массового копирования
// (фиксируется на старте режима assignloc). locationTypeName: null — тип не задан, не менять.
export type AssignLocation = { zoneId: string | null; floors: number[]; locationTypeName: string | null };

// Режимы выбора с чекбоксами и все массовые операции сметы (перенос/копирование
// материалов, удаление, тиражирование, назначение локации, ревью несогласованных).
// Выделение сбрасывается только после успеха операции; ошибку показывает мутация.
export function useSmetaSelection({
  groups,
  onReassignMaterials,
  onCopyMaterials,
  onBulkDelete,
  onBulkAssignLocation,
  onReplicate,
  onBulkConfirm,
}: {
  groups: CostTypeGroup[];
  onReassignMaterials: (materialIds: string[], itemId: string) => Promise<void>;
  onCopyMaterials: (materialIds: string[], itemId: string) => Promise<void>;
  onBulkDelete: (workIds: string[], materialIds: string[]) => Promise<unknown>;
  onBulkAssignLocation: (workIds: string[], assign: AssignLocation) => Promise<unknown>;
  onReplicate: (sourceWorkIds: string[], targets: ReplicateTargets) => Promise<void>;
  onBulkConfirm: (workIds: string[], materialIds: string[]) => Promise<void>;
}) {
  const { message } = App.useApp();
  // Единый режим выбора с чекбоксами: перенос ('reassign'), удаление ('delete'),
  // тиражирование ('replicate') или назначение местоположения ('assignloc').
  const [mode, setMode] = useState<SelectionMode>('none');
  // Чекбоксы материалов видны в reassign/copy/delete; в assignloc выбираем только работы.
  const selectionMode = mode !== 'none' && mode !== 'assignloc';
  // Чекбоксы работ активны в delete и replicate (выбор шаблона для тиражирования).
  const deleteModeFlag = mode === 'delete' || mode === 'replicate' || mode === 'assignloc';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // выбранные материалы (общий набор)
  const [selectedWorkIds, setSelectedWorkIds] = useState<Set<string>>(new Set()); // выбранные работы (delete/replicate/assignloc)
  const [reassigning, setReassigning] = useState(false);
  const [copying, setCopying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [replicateOpen, setReplicateOpen] = useState(false);
  const [replicating, setReplicating] = useState(false);
  // Назначение местоположения выбранным работам: снапшот локации + флаг выполнения.
  const [assignLoc, setAssignLoc] = useState<AssignLocation | null>(null);
  const [assigning, setAssigning] = useState(false);
  // Модалка ревью несогласованных позиций (согласовать/удалить выделенное).
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewConfirming, setReviewConfirming] = useState(false);
  const [reviewDeleting, setReviewDeleting] = useState(false);

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

  // Сброс только галочек (для эффекта «смена фильтра сбрасывает выделение, но не режим»).
  const clearSelections = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedWorkIds(new Set());
  }, []);

  const cancelSelection = () => {
    setSelectedIds(new Set());
    setSelectedWorkIds(new Set());
    setAssignLoc(null);
    setMode('none');
  };

  // Старт режима копирования параметров: снапшот локации/типа из поповера, чистый выбор работ.
  const startAssignLocation = (loc: AssignLocation) => {
    setAssignLoc(loc);
    setSelectedIds(new Set());
    setSelectedWorkIds(new Set());
    setMode('assignloc');
  };

  // Копирование снапшота параметров на выбранные работы. Выделение сбрасываем только после успеха.
  const handleBulkAssign = async () => {
    if (!assignLoc || selectedWorkIds.size === 0 || assigning) return;
    setAssigning(true);
    try {
      await onBulkAssignLocation([...selectedWorkIds], assignLoc);
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

  return {
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
  };
}
