import { useCallback, useMemo, useRef, useState } from 'react';
import { App } from 'antd';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '../../services/api';
import { invalidateEstimateQueries } from '../../lib/estimateQueries';
import { useEstimateRealtime } from '../../hooks/useEstimateRealtime';
import { getEffectiveAddContext } from '../../store/locationContextStore';
import { parseFloors } from './components/location';
import type { ReplicateTargets } from './components/ReplicateWorksModal';
import type { SaveWorkPayload, SaveMaterialPayload } from './components/CostTypeGroupBlock';
import { AddCostTypeModal, type CostTypeFormPayload } from './components/AddCostTypeModal';
import { EditEstimateModal, type EditEstimatePayload } from './components/EditEstimateModal';
import { buildCostTypeGroups, type CostTypeGroup, type EstimateDetail } from './components/types';
import { EstimateWorkspace } from './workspace/EstimateWorkspace';
import type { RateLeafPayload } from './workspace/types';

interface Organization {
  id: string;
  name: string;
  type?: string;
}

interface Props {
  estimate: EstimateDetail;
  orgs?: Organization[];
  onBack: () => void;
  /** Ключ запроса, который загрузил эту смету — его инвалидируем после мутаций. */
  refetchKey: QueryKey;
}

// Редактор сметы: 3-панельный workspace + все мутации, привязанные к estimate.id.
// Используется и объектной страницей (/projects/:id), и /estimates/:id.
export function EstimateEditor({ estimate, orgs, onBack, refetchKey }: Props) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const [costTypeModalOpen, setCostTypeModalOpen] = useState(false);
  const [editEstimateOpen, setEditEstimateOpen] = useState(false);
  const [pendingGroups, setPendingGroups] = useState<CostTypeGroup[]>([]);

  const estimateId = estimate.id;
  const projectId = estimate.project_id;

  // refetchKey приходит сырым массивом (нестабильная identity) — держим в ref, чтобы колбэк
  // оставался стабильным и не плодил повторные инвалидации в эффектах дочерних панелей.
  const refetchKeyRef = useRef(refetchKey);
  refetchKeyRef.current = refetchKey;
  const invalidate = useCallback(() => {
    invalidateEstimateQueries(queryClient, { estimateId, projectId, refetchKey: refetchKeyRef.current });
  }, [queryClient, estimateId, projectId]);

  // Realtime: изменения коллег (и ИИ) подтягиваются без перезагрузки страницы.
  useEstimateRealtime(estimateId, projectId);

  const editEstimateMutation = useMutation({
    mutationFn: (payload: EditEstimatePayload) => api.put(`/estimates/${estimateId}`, payload),
    onSuccess: () => {
      invalidate();
      setEditEstimateOpen(false);
      message.success('Смета обновлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Текущий контекст добавления местоположения (с учётом флага «Добавлять в указанное
  // местоположение»; читается на момент мутации, не из замыкания рендера).
  // Точный набор этажей с разрывами → источник истины locations: [{zoneId, floors}].
  const currentAddLocation = () => {
    const ctx = getEffectiveAddContext(estimateId);
    const floors = parseFloors(ctx.floorsText);
    if (!ctx.zoneId && floors.length === 0) return {};
    return { locations: [{ zoneId: ctx.zoneId, floors }] };
  };

  const createWorkMutation = useMutation({
    mutationFn: ({ costTypeId, payload }: { costTypeId: string | null; payload: SaveWorkPayload }) =>
      api.post(`/estimates/${estimateId}/items`, { ...currentAddLocation(), ...payload, costTypeId }),
    onSuccess: () => {
      invalidate();
      message.success('Работа добавлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Тиражирование набора работ на целевые локации (корпуса × типы помещений, диапазон этажей).
  const replicateWorksMutation = useMutation({
    mutationFn: ({ sourceWorkIds, targets }: { sourceWorkIds: string[]; targets: ReplicateTargets }) =>
      api.post<{ created: { works: number; materials: number }; skipped: number; copyBatchId: string }>(
        `/estimates/${estimateId}/replicate-items`,
        { sourceItemIds: sourceWorkIds, ...targets },
      ),
    onSuccess: (res) => {
      invalidate();
      message.success(`Создано строк: ${res.created.works}${res.skipped ? ` (пропущено дублей: ${res.skipped})` : ''}`);
    },
    onError: (e: Error) => message.error(e.message),
  });

  const updateWorkMutation = useMutation({
    mutationFn: ({ workId, payload }: { workId: string; payload: SaveWorkPayload }) =>
      api.put(`/estimates/items/${workId}`, payload),
    onSuccess: () => {
      invalidate();
      message.success('Работа обновлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteWorkMutation = useMutation({
    mutationFn: (workId: string) => api.delete(`/estimates/items/${workId}`),
    onSuccess: () => {
      invalidate();
      message.success('Работа удалена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Перестановка работ внутри вида (кнопки ↑/↓): шлём полный список id в новом порядке.
  const reorderWorksMutation = useMutation({
    mutationFn: (ids: string[]) => api.patch(`/estimates/${estimateId}/items/reorder`, { ids }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => message.error(e.message),
  });

  const createMaterialMutation = useMutation({
    mutationFn: ({ workId, payload }: { workId: string; payload: SaveMaterialPayload }) =>
      api.post(`/estimate-items/${workId}/materials`, payload),
    onSuccess: () => {
      invalidate();
      message.success('Материал добавлен');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const updateMaterialMutation = useMutation({
    mutationFn: ({ materialId, payload }: { materialId: string; payload: SaveMaterialPayload }) =>
      api.put(`/estimate-items/materials/${materialId}`, payload),
    onSuccess: () => {
      invalidate();
      message.success('Материал обновлён');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteMaterialMutation = useMutation({
    mutationFn: (materialId: string) => api.delete(`/estimate-items/materials/${materialId}`),
    onSuccess: () => {
      invalidate();
      message.success('Материал удалён');
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Массовое удаление работ (с каскадом материалов) и отдельных материалов — одним атомарным запросом.
  const bulkDeleteMutation = useMutation({
    mutationFn: ({ workIds, materialIds }: { workIds: string[]; materialIds: string[] }) =>
      api.post(`/estimates/${estimateId}/bulk-delete`, { workIds, materialIds }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => message.error(e.message),
  });

  // Подтверждение «предложенного» материала (добавлен автоматически по типовому набору расценки).
  // Для ИИ-материала ({status:'confirmed'}) сервер также снимает needs_review — используется и
  // при согласовании кликом по тегу «не согласовано».
  const confirmMaterialMutation = useMutation({
    mutationFn: (materialId: string) =>
      api.put(`/estimate-items/materials/${materialId}`, { status: 'confirmed' }),
    onSuccess: () => {
      invalidate();
      // Согласованный материал зеркалируется в legacy-справочник — обновляем его кэш.
      queryClient.invalidateQueries({ queryKey: ['materials-tree'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      message.success('Материал подтверждён');
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Согласование ИИ-работы кликом по тегу «не согласовано» — снимает needs_review.
  const confirmWorkMutation = useMutation({
    mutationFn: (workId: string) =>
      api.put(`/estimates/items/${workId}`, { needsReview: false }),
    onSuccess: () => {
      invalidate();
      message.success('Работа согласована');
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Выборочное согласование работ и материалов (модалка ревью). Согласованные материалы
  // зеркалируются в legacy-справочник — после успеха инвалидируем и каталог материалов.
  const bulkConfirmMutation = useMutation({
    mutationFn: ({ workIds, materialIds }: { workIds: string[]; materialIds: string[] }) =>
      api.post<{ works: number; materials: number }>(`/estimates/${estimateId}/bulk-confirm`, { workIds, materialIds }),
    onSuccess: (res) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['materials-tree'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      message.success(`Согласовано: работ ${res.works}, материалов ${res.materials}`);
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Перенос материала к другой работе (ревью ИИ-извлечения) — снимает needs_review на сервере.
  const reassignMaterialMutation = useMutation({
    mutationFn: ({ materialId, itemId }: { materialId: string; itemId: string }) =>
      api.patch(`/estimate-items/materials/${materialId}/reassign`, { itemId }),
    onSuccess: () => {
      invalidate();
      message.success('Материал перенесён к работе');
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Массовый перенос материалов к одной работе — снимает needs_review на сервере.
  const reassignMaterialsBulkMutation = useMutation({
    mutationFn: ({ materialIds, itemId }: { materialIds: string[]; itemId: string }) =>
      api.patch<{ count: number }>('/estimate-items/materials/reassign-bulk', { materialIds, itemId }),
    onSuccess: (res) => {
      invalidate();
      message.success(`Перенесено материалов: ${res.count}`);
    },
    onError: (e: Error) => message.error(e.message),
  });

  const setContractorMutation = useMutation({
    mutationFn: ({ costTypeId, contractorId }: { costTypeId: string; contractorId: string }) =>
      api.put(`/estimates/${estimateId}/contractors`, { costTypeId, contractorId }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => message.error(e.message),
  });

  const clearContractorMutation = useMutation({
    mutationFn: (costTypeId: string) =>
      api.delete(`/estimates/${estimateId}/contractors?costTypeId=${encodeURIComponent(costTypeId)}`),
    onSuccess: () => invalidate(),
    onError: (e: Error) => message.error(e.message),
  });

  const groups = useMemo(
    () => buildCostTypeGroups(estimate.items, estimate.contractors, pendingGroups),
    [estimate, pendingGroups],
  );

  const totalItems = estimate.items?.length ?? 0;

  const handleAddCostType = (payload: CostTypeFormPayload) => {
    setPendingGroups((prev) =>
      prev.some((g) => g.costTypeId === payload.costTypeId)
        ? prev
        : [
            ...prev,
            {
              costTypeId: payload.costTypeId,
              costTypeName: payload.costTypeName,
              costTypeSortOrder: null,
              costCategoryId: payload.costCategoryId,
              costCategoryName: payload.costCategoryName,
              costCategorySortOrder: null,
              works: [],
              contractor: null,
            },
          ],
    );
    if (payload.contractorId) {
      setContractorMutation.mutate({ costTypeId: payload.costTypeId, contractorId: payload.contractorId });
    }
    setCostTypeModalOpen(false);
  };

  const createWork = (costTypeId: string | null, payload: SaveWorkPayload) =>
    createWorkMutation.mutateAsync({ costTypeId, payload }).then(() => undefined);
  const updateWork = (workId: string, payload: SaveWorkPayload) =>
    updateWorkMutation.mutateAsync({ workId, payload }).then(() => undefined);
  const createMaterial = (workId: string, payload: SaveMaterialPayload) =>
    createMaterialMutation.mutateAsync({ workId, payload }).then(() => undefined);
  const updateMaterial = (materialId: string, payload: SaveMaterialPayload) =>
    updateMaterialMutation.mutateAsync({ materialId, payload }).then(() => undefined);

  // Добавление работы из дерева справочника: регистрируем «отложенную» группу
  // (чтобы заголовок вида работ показался сразу с правильным именем) и создаём работу.
  const handleAddRate = (p: RateLeafPayload) => {
    setPendingGroups((prev) =>
      prev.some((g) => g.costTypeId === p.costTypeId)
        ? prev
        : [
            ...prev,
            {
              costTypeId: p.costTypeId,
              costTypeName: p.costTypeName,
              costTypeSortOrder: null,
              costCategoryId: p.costCategoryId,
              costCategoryName: p.costCategoryName,
              costCategorySortOrder: null,
              works: [],
              contractor: null,
            },
          ],
    );
    createWorkMutation.mutate({
      costTypeId: p.costTypeId,
      payload: {
        costTypeId: p.costTypeId,
        rateId: p.rateId,
        description: p.name,
        unit: p.unit,
        quantity: 1,
        unitPrice: p.price,
      },
    });
  };

  return (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <EstimateWorkspace
        estimate={estimate}
        groups={groups}
        orgs={orgs}
        onEstimateChanged={invalidate}
        totalItems={totalItems}
        groupCount={groups.length}
        onBack={onBack}
        onEdit={() => setEditEstimateOpen(true)}
        onAddCostType={() => setCostTypeModalOpen(true)}
        onCreateWork={createWork}
        onUpdateWork={updateWork}
        onDeleteWork={(workId) => deleteWorkMutation.mutate(workId)}
        onReorderWorks={(ids) => reorderWorksMutation.mutate(ids)}
        onCreateMaterial={createMaterial}
        onUpdateMaterial={updateMaterial}
        onDeleteMaterial={(materialId) => deleteMaterialMutation.mutate(materialId)}
        onConfirmMaterial={(materialId) => confirmMaterialMutation.mutate(materialId)}
        onConfirmWork={(workId) => confirmWorkMutation.mutate(workId)}
        onBulkConfirm={(workIds, materialIds) =>
          bulkConfirmMutation.mutateAsync({ workIds, materialIds }).then(() => undefined)}
        onReassignMaterial={(materialId, itemId) => reassignMaterialMutation.mutate({ materialId, itemId })}
        onReassignMaterials={(materialIds, itemId) =>
          reassignMaterialsBulkMutation.mutateAsync({ materialIds, itemId }).then(() => undefined)}
        onBulkDelete={(workIds, materialIds) =>
          bulkDeleteMutation.mutateAsync({ workIds, materialIds })}
        onReplicate={(sourceWorkIds, targets) =>
          replicateWorksMutation.mutateAsync({ sourceWorkIds, targets }).then(() => undefined)}
        onSetContractor={(costTypeId, contractorId) =>
          setContractorMutation.mutate({ costTypeId, contractorId })
        }
        onClearContractor={(costTypeId) => clearContractorMutation.mutate(costTypeId)}
        onAddRate={handleAddRate}
      />

      <AddCostTypeModal
        open={costTypeModalOpen}
        initialCategoryId={estimate.cost_category_id}
        onCancel={() => setCostTypeModalOpen(false)}
        onSubmit={handleAddCostType}
        loading={setContractorMutation.isPending}
      />

      <EditEstimateModal
        open={editEstimateOpen}
        initialValues={{
          costCategoryId: estimate.cost_category_id,
          workType: estimate.work_type,
          notes: estimate.notes,
        }}
        onCancel={() => setEditEstimateOpen(false)}
        onSubmit={(payload) => editEstimateMutation.mutate(payload)}
        loading={editEstimateMutation.isPending}
      />
    </div>
  );
}
