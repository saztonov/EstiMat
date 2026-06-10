import { useMemo, useState } from 'react';
import { App } from 'antd';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '../../services/api';
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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: refetchKey });
    queryClient.invalidateQueries({ queryKey: ['projects-with-stats'] });
  };

  const editEstimateMutation = useMutation({
    mutationFn: (payload: EditEstimatePayload) => api.put(`/estimates/${estimateId}`, payload),
    onSuccess: () => {
      invalidate();
      setEditEstimateOpen(false);
      message.success('Смета обновлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const createWorkMutation = useMutation({
    mutationFn: ({ costTypeId, payload }: { costTypeId: string | null; payload: SaveWorkPayload }) =>
      api.post(`/estimates/${estimateId}/items`, { ...payload, costTypeId }),
    onSuccess: () => {
      invalidate();
      message.success('Работа добавлена');
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

  // Подтверждение «предложенного» материала (добавлен автоматически по типовому набору расценки)
  const confirmMaterialMutation = useMutation({
    mutationFn: (materialId: string) =>
      api.put(`/estimate-items/materials/${materialId}`, { status: 'confirmed' }),
    onSuccess: () => {
      invalidate();
      message.success('Материал подтверждён');
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
              costCategoryId: payload.costCategoryId,
              costCategoryName: payload.costCategoryName,
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
              costCategoryId: p.costCategoryId,
              costCategoryName: p.costCategoryName,
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
        totalItems={totalItems}
        groupCount={groups.length}
        onBack={onBack}
        onEdit={() => setEditEstimateOpen(true)}
        onAddCostType={() => setCostTypeModalOpen(true)}
        onCreateWork={createWork}
        onUpdateWork={updateWork}
        onDeleteWork={(workId) => deleteWorkMutation.mutate(workId)}
        onCreateMaterial={createMaterial}
        onUpdateMaterial={updateMaterial}
        onDeleteMaterial={(materialId) => deleteMaterialMutation.mutate(materialId)}
        onConfirmMaterial={(materialId) => confirmMaterialMutation.mutate(materialId)}
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
