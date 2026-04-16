import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button, Space, Spin, App, Empty } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { EstimateHeaderCard } from './components/EstimateHeaderCard';
import { SectionBlock, type SaveItemPayload } from './components/SectionBlock';
import { AddSectionModal, type SectionFormPayload } from './components/AddSectionModal';
import { EditEstimateModal, type EditEstimatePayload } from './components/EditEstimateModal';
import type { EstimateDetail } from './components/types';

export function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [editSectionId, setEditSectionId] = useState<string | null>(null);
  const [editEstimateOpen, setEditEstimateOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['estimate', id],
    queryFn: () => api.get<{ data: EstimateDetail }>(`/estimates/${id}`),
    enabled: !!id,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['estimate', id] });

  const editEstimateMutation = useMutation({
    mutationFn: (payload: EditEstimatePayload) => api.put(`/estimates/${id}`, payload),
    onSuccess: () => {
      invalidate();
      setEditEstimateOpen(false);
      message.success('Смета обновлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const addSectionMutation = useMutation({
    mutationFn: (payload: SectionFormPayload) => api.post(`/estimates/${id}/sections`, payload),
    onSuccess: () => {
      invalidate();
      setSectionModalOpen(false);
      message.success('Раздел добавлен');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const editSectionMutation = useMutation({
    mutationFn: ({ sectionId, payload }: { sectionId: string; payload: SectionFormPayload }) =>
      api.put(`/estimates/sections/${sectionId}`, payload),
    onSuccess: () => {
      invalidate();
      setEditSectionId(null);
      message.success('Раздел обновлён');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteSectionMutation = useMutation({
    mutationFn: (sectionId: string) => api.delete(`/estimates/sections/${sectionId}`),
    onSuccess: () => {
      invalidate();
      message.success('Раздел удалён');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ sectionId, payload }: { sectionId: string; payload: SaveItemPayload }) =>
      api.post(`/estimates/sections/${sectionId}/items`, payload),
    onSuccess: () => {
      invalidate();
      message.success('Позиция добавлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, payload }: { itemId: string; payload: SaveItemPayload }) =>
      api.put(`/estimates/items/${itemId}`, payload),
    onSuccess: () => {
      invalidate();
      message.success('Позиция обновлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => api.delete(`/estimates/items/${itemId}`),
    onSuccess: () => {
      invalidate();
      message.success('Позиция удалена');
    },
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

  if (isLoading) return <Spin size="large" />;

  const estimate = data?.data;
  if (!estimate) return <div>Смета не найдена</div>;

  const isDraft = estimate.status === 'draft';
  const totalItems = estimate.sections?.reduce((acc, s) => acc + s.items.length, 0) ?? 0;

  const editingSection = editSectionId
    ? estimate.sections.find((s) => s.id === editSectionId)
    : null;

  const handleCreateItem = (sectionId: string, payload: SaveItemPayload) =>
    addItemMutation.mutateAsync({ sectionId, payload }).then(() => undefined);

  const handleUpdateItem = (itemId: string, payload: SaveItemPayload) =>
    updateItemMutation.mutateAsync({ itemId, payload }).then(() => undefined);

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
        editable={isDraft}
        onEdit={() => setEditEstimateOpen(true)}
      />

      {isDraft && (
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => setSectionModalOpen(true)}
          style={{ width: '100%', marginTop: 8, marginBottom: 16 }}
        >
          Добавить раздел
        </Button>
      )}

      {estimate.sections && estimate.sections.length > 0 ? (
        <>
          {estimate.sections.map((section, i) => (
            <SectionBlock
              key={section.id}
              section={section}
              index={i}
              editable={isDraft}
              onCreateItem={handleCreateItem}
              onUpdateItem={handleUpdateItem}
              onDeleteItem={(itemId) => deleteItemMutation.mutate(itemId)}
              onEditSection={(sectionId) => setEditSectionId(sectionId)}
              onDeleteSection={(sectionId) => deleteSectionMutation.mutate(sectionId)}
            />
          ))}
          {isDraft && (
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => setSectionModalOpen(true)}
              style={{ width: '100%', marginTop: 8 }}
            >
              Добавить раздел
            </Button>
          )}
        </>
      ) : (
        <Empty description="В смете пока нет разделов" style={{ padding: '40px 0' }} />
      )}

      <AddSectionModal
        open={sectionModalOpen}
        mode="create"
        onCancel={() => setSectionModalOpen(false)}
        onSubmit={(payload) => addSectionMutation.mutate(payload)}
        loading={addSectionMutation.isPending}
      />

      <AddSectionModal
        open={!!editingSection}
        mode="edit"
        initialValues={
          editingSection
            ? {
                costCategoryId: editingSection.cost_category_id ?? undefined,
                costTypeId: editingSection.cost_type_id ?? undefined,
                contractorId: editingSection.contractor_id ?? null,
              }
            : undefined
        }
        onCancel={() => setEditSectionId(null)}
        onSubmit={(payload) => {
          if (!editingSection) return;
          editSectionMutation.mutate({ sectionId: editingSection.id, payload });
        }}
        loading={editSectionMutation.isPending}
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
