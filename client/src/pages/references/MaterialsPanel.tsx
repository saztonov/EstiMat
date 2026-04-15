import { useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Select, Space, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';

export function MaterialsPanel() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data: materials, isLoading } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/materials'),
  });

  const { data: groups } = useQuery({
    queryKey: ['material-groups'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/materials/groups'),
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/materials', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      closeModal();
      message.success('Материал добавлен');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) =>
      api.put(`/materials/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      closeModal();
      message.success('Материал обновлён');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ unitPrice: 0 });
    setModalOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setEditingId(row.id as string);
    form.setFieldsValue({
      name: row.name,
      groupId: row.group_id,
      unit: row.unit,
      unitPrice: Number(row.unit_price ?? 0),
      description: row.description,
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
    { title: 'Группа', dataIndex: 'group_name', width: 200 },
    { title: 'Ед. изм.', dataIndex: 'unit', width: 100 },
    {
      title: 'Цена, ₽',
      dataIndex: 'unit_price',
      width: 120,
      align: 'right' as const,
      render: (v: string | number) => Number(v ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 }),
    },
    { title: 'Описание', dataIndex: 'description', ellipsis: true },
    {
      title: '',
      width: 80,
      render: (_: unknown, row: Record<string, unknown>) => (
        <Button type="link" onClick={() => openEdit(row)}>Изменить</Button>
      ),
    },
  ];

  return (
    <div className="table-page-wrapper">
      <Space style={{ marginBottom: 16, flexShrink: 0 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={materials?.data} loading={isLoading} scroll={{ y: 'flex' }} />

      <Modal
        title={editingId ? 'Редактирование материала' : 'Новый материал'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="groupId" label="Группа">
            <Select
              allowClear
              placeholder="Выберите группу"
              options={groups?.data.map((g) => ({ value: g.id as string, label: g.name as string }))}
            />
          </Form.Item>
          <Form.Item name="unit" label="Единица измерения" rules={[{ required: true }]}>
            <Input placeholder="м, шт, кг" />
          </Form.Item>
          <Form.Item name="unitPrice" label="Цена, ₽" rules={[{ required: true, type: 'number', min: 0 }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} decimalSeparator="," />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
