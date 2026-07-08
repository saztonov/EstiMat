import { useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Switch, Popconfirm, Space, Tag, App } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';

// Глобальный справочник типов помещений (квартира, МОП, лестничная клетка и т.п.).
export function RoomTypesPanel() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'admin' || role === 'engineer';

  const { data: roomTypes, isLoading } = useQuery({
    queryKey: ['room-types'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/room-types'),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['room-types'] });
    queryClient.invalidateQueries({ queryKey: ['project-room-types'] });
  };

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/room-types', values),
    onSuccess: () => { invalidate(); closeModal(); message.success('Тип помещения добавлен'); },
    onError: (err: Error) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) =>
      api.put(`/room-types/${id}`, values),
    onSuccess: () => { invalidate(); closeModal(); message.success('Тип помещения обновлён'); },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/room-types/${id}`),
    onSuccess: () => { invalidate(); message.success('Тип помещения удалён'); },
    onError: (err: Error) => message.error(err.message),
  });

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ sortOrder: 0, isActive: true });
    setModalOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setEditingId(row.id as string);
    form.setFieldsValue({
      name: row.name,
      code: row.code ?? undefined,
      sortOrder: Number(row.sort_order ?? 0),
      isActive: row.is_active !== false,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    form.resetFields();
  };

  const onSubmit = (values: Record<string, unknown>) => {
    if (editingId) updateMutation.mutate({ id: editingId, values });
    else createMutation.mutate(values);
  };

  const columns = [
    { title: 'Название', dataIndex: 'name' },
    {
      title: 'Активен',
      dataIndex: 'is_active',
      width: 100,
      align: 'center' as const,
      render: (v: unknown) => (v === false ? <Tag>нет</Tag> : <Tag color="green">да</Tag>),
    },
    { title: 'Порядок', dataIndex: 'sort_order', width: 100, align: 'center' as const },
    ...(canEdit
      ? [{
          title: '',
          width: 140,
          render: (_: unknown, row: Record<string, unknown>) => (
            <Space size={0}>
              <Button type="link" onClick={() => openEdit(row)}>Изменить</Button>
              <Popconfirm title="Удалить тип помещения?" onConfirm={() => deleteMutation.mutate(row.id as string)}>
                <Button type="link" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          ),
        }]
      : []),
  ];

  return (
    <div className="table-page-wrapper">
      {canEdit && (
        <Space style={{ marginBottom: 16, flexShrink: 0 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>
        </Space>
      )}
      <Table rowKey="id" columns={columns} dataSource={roomTypes?.data} loading={isLoading} scroll={{ x: 560, y: 'flex' }} pagination={DEFAULT_PAGINATION} />

      <Modal
        title={editingId ? 'Редактирование типа помещения' : 'Новый тип помещения'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Квартира, МОП коридор, Лестничная клетка" />
          </Form.Item>
          <Form.Item name="code" label="Код (необязательно)">
            <Input placeholder="напр. LK" />
          </Form.Item>
          <Form.Item name="sortOrder" label="Порядок сортировки">
            <InputNumber style={{ width: '100%' }} min={0} step={1} />
          </Form.Item>
          <Form.Item name="isActive" label="Активен" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
