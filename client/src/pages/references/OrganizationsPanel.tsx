import { useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, Space, Popconfirm, App } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { ORG_TYPE_LABELS, ORG_TYPES } from '@estimat/shared';

export function OrganizationsPanel() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/organizations'),
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/organizations', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      closeModal();
      message.success('Организация создана');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...values }: Record<string, unknown>) => api.put(`/organizations/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      closeModal();
      message.success('Организация обновлена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      message.success('Организация деактивирована');
    },
    onError: (err: Error) => message.error(err.message),
  });

  function closeModal() {
    setModalOpen(false);
    setEditRecord(null);
    form.resetFields();
  }

  function openEdit(record: Record<string, unknown>) {
    setEditRecord(record);
    form.setFieldsValue({
      name: record.name,
      inn: record.inn,
      type: record.type,
      address: record.address,
    });
    setModalOpen(true);
  }

  function onFinish(values: Record<string, unknown>) {
    if (editRecord) {
      updateMutation.mutate({ id: editRecord.id, ...values });
    } else {
      createMutation.mutate(values);
    }
  }

  const columns = [
    { title: 'Название', dataIndex: 'name' },
    { title: 'ИНН', dataIndex: 'inn', width: 140 },
    {
      title: 'Тип',
      dataIndex: 'type',
      width: 160,
      render: (type: string) => <Tag>{ORG_TYPE_LABELS[type as keyof typeof ORG_TYPE_LABELS] || type}</Tag>,
    },
    {
      title: 'Активна',
      dataIndex: 'is_active',
      width: 100,
      render: (v: boolean) => v ? <Tag color="green">Да</Tag> : <Tag color="red">Нет</Tag>,
    },
    {
      title: 'Действия',
      width: 120,
      render: (_: unknown, record: Record<string, unknown>) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); openEdit(record); }} />
          <Popconfirm title="Деактивировать организацию?" onConfirm={() => deleteMutation.mutate(record.id as string)} onPopupClick={(e) => e.stopPropagation()}>
            <Button type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Создать</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={data?.data} loading={isLoading} />

      <Modal
        title={editRecord ? 'Редактирование организации' : 'Новая организация'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="inn" label="ИНН">
            <Input />
          </Form.Item>
          <Form.Item name="type" label="Тип" rules={[{ required: true }]}>
            <Select options={ORG_TYPES.map((t) => ({ value: t, label: ORG_TYPE_LABELS[t] }))} />
          </Form.Item>
          <Form.Item name="address" label="Адрес">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
