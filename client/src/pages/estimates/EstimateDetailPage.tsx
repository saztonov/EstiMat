import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button, Space, Spin, App, Empty } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { EstimateHeaderCard } from './components/EstimateHeaderCard';
import {
  CostTypeGroupBlock,
  type SaveWorkPayload,
  type SaveMaterialPayload,
} from './components/CostTypeGroupBlock';
import { AddCostTypeModal, type CostTypeFormPayload } from './components/AddCostTypeModal';
import { EditEstimateModal, type EditEstimatePayload } from './components/EditEstimateModal';
import { buildCostTypeGroups, type CostTypeGroup, type EstimateDetail } from './components/types';

interface Organization {
  id: string;
  name: string;
  type?: string;
}

export function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const [costTypeModalOpen, setCostTypeModalOpen] = useState(false);
  const [editEstimateOpen, setEditEstimateOpen] = useState(false);
  const [pendingGroups, setPendingGroups] = useState<CostTypeGroup[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['estimate', id],
    queryFn: () => api.get<{ data: EstimateDetail }>(`/estimates/${id}`),
    enabled: !!id,
  });

  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Organization[] }>('/organizations'),
  });

  const estimate = data?.data;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['estimate', id] });
    if (estimate) {
      queryClient.invalidateQueries({ queryKey: ['project-summary', estimate.project_id] });
      queryClient.invalidateQueries({ queryKey: ['estimates', estimate.project_id] });
      queryClient.invalidateQueries({ queryKey: ['projects-with-stats'] });
    }
  };

  const editEstimateMutation = useMutation({
    mutationFn: (payload: EditEstimatePayload) => api.put(`/estimates/${id}`, payload),
    onSuccess: () => {
      invalidate();
      setEditEstimateOpen(false);
      message.success('Смета обновлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const createWorkMutation = useMutation({
    mutationFn: ({ costTypeId, payload }: { costTypeId: string | null; payload: SaveWorkPayload }) =>
      api.post(`/estimates/${id}/items`, { ...payload, costTypeId }),
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

  const setContractorMutation = useMutation({
    mutationFn: ({ costTypeId, contractorId }: { costTypeId: string; contractorId: string }) =>
      api.put(`/estimates/${id}/contractors`, { costTypeId, contractorId }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => message.error(e.message),
  });

  const clearContractorMutation = useMutation({
    mutationFn: (costTypeId: string) =>
      api.delete(`/estimates/${id}/contractors?costTypeId=${encodeURIComponent(costTypeId)}`),
    onSuccess: () => invalidate(),
    onError: (e: Error) => message.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/estimates/${id}/status`, { status }),
    onSuccess: () => {
      invalidate();
      message.success('Статус обновлён');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const groups = useMemo(
    () => (estimate ? buildCostTypeGroups(estimate.items, estimate.contractors, pendingGroups) : []),
    [estimate, pendingGroups],
  );

  if (isLoading) return <Spin size="large" />;
  if (!estimate) return <div>Смета не найдена</div>;

  const isDraft = estimate.status === 'draft';
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/projects/${estimate.project_id}?tab=estimates`)}
        >
          К объекту
        </Button>
        <Space>
          {isDraft && (
            <Button type="primary" icon={<CheckOutlined />} onClick={() => statusMutation.mutate('review')}>
              На проверку
            </Button>
          )}
          {estimate.status === 'review' && (
            <Button type="primary" icon={<CheckOutlined />} onClick={() => statusMutation.mutate('approved')}>
              Утвердить
            </Button>
          )}
        </Space>
      </div>

      <EstimateHeaderCard
        estimate={estimate}
        itemCount={totalItems}
        groupCount={groups.length}
        editable
        onEdit={() => setEditEstimateOpen(true)}
      />

      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={() => setCostTypeModalOpen(true)}
        style={{ width: '100%', marginTop: 8, marginBottom: 16 }}
      >
        Добавить вид затрат
      </Button>

      {groups.length > 0 ? (
        <>
          {groups.map((group, i) => (
            <CostTypeGroupBlock
              key={group.costTypeId ?? '__none__'}
              group={group}
              index={i}
              editable
              orgs={orgsData?.data}
              onCreateWork={createWork}
              onUpdateWork={updateWork}
              onDeleteWork={(workId) => deleteWorkMutation.mutate(workId)}
              onCreateMaterial={createMaterial}
              onUpdateMaterial={updateMaterial}
              onDeleteMaterial={(materialId) => deleteMaterialMutation.mutate(materialId)}
              onSetContractor={(costTypeId, contractorId) =>
                setContractorMutation.mutate({ costTypeId, contractorId })
              }
              onClearContractor={(costTypeId) => clearContractorMutation.mutate(costTypeId)}
            />
          ))}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setCostTypeModalOpen(true)}
            style={{ width: '100%', marginTop: 8 }}
          >
            Добавить вид затрат
          </Button>
        </>
      ) : (
        <Empty description="В смете пока нет работ" style={{ padding: '40px 0' }} />
      )}

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
