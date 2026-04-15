import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button, Space, Spin, App, Empty } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { EstimateHeaderCard } from './components/EstimateHeaderCard';
import { SectionBlock } from './components/SectionBlock';
import { AddSectionModal } from './components/AddSectionModal';
import { AddItemModal, type AddItemPayload } from './components/AddItemModal';
import type { EstimateDetail } from './components/types';

export function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [itemModal, setItemModal] = useState<{ sectionId: string; type: 'work' | 'material' } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['estimate', id],
    queryFn: () => api.get<{ data: EstimateDetail }>(`/estimates/${id}`),
    enabled: !!id,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['estimate', id] });

  const addSectionMutation = useMutation({
    mutationFn: (rateId: string) => api.post(`/estimates/${id}/sections`, { rateId }),
    onSuccess: () => {
      invalidate();
      setSectionModalOpen(false);
      message.success('Раздел добавлен');
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
    mutationFn: ({ sectionId, payload }: { sectionId: string; payload: AddItemPayload }) =>
      api.post(`/estimates/sections/${sectionId}/items`, payload),
    onSuccess: () => {
      invalidate();
      setItemModal(null);
      message.success('Позиция добавлена');
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

      <EstimateHeaderCard estimate={estimate} itemCount={totalItems} />

      {estimate.sections && estimate.sections.length > 0 ? (
        estimate.sections.map((section, i) => (
          <SectionBlock
            key={section.id}
            section={section}
            index={i}
            editable={isDraft}
            onAddItem={(sectionId, type) => setItemModal({ sectionId, type })}
            onDeleteItem={(itemId) => deleteItemMutation.mutate(itemId)}
            onDeleteSection={(sectionId) => deleteSectionMutation.mutate(sectionId)}
          />
        ))
      ) : (
        <Empty description="В смете пока нет разделов" style={{ padding: '40px 0' }} />
      )}

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

      <AddSectionModal
        open={sectionModalOpen}
        onCancel={() => setSectionModalOpen(false)}
        onSubmit={(rateId) => addSectionMutation.mutate(rateId)}
        loading={addSectionMutation.isPending}
      />

      <AddItemModal
        open={!!itemModal}
        itemType={itemModal?.type ?? 'work'}
        onCancel={() => setItemModal(null)}
        onSubmit={(payload) => {
          if (!itemModal) return;
          addItemMutation.mutate({ sectionId: itemModal.sectionId, payload });
        }}
        loading={addItemMutation.isPending}
      />
    </div>
  );
}
