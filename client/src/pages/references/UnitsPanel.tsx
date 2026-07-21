import { useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Popconfirm, Space, Select, Tag, App } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';

export function UnitsPanel() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data: units, isLoading } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/units'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['units'] });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/units', values),
    onSuccess: () => {
      invalidate();
      closeModal();
      message.success('Единица добавлена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) =>
      api.put(`/units/${id}`, values),
    onSuccess: () => {
      invalidate();
      closeModal();
      message.success('Единица обновлена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/units/${id}`),
    onSuccess: () => {
      invalidate();
      message.success('Единица удалена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ sortOrder: 0 });
    setModalOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setEditingId(row.id as string);
    form.setFieldsValue({
      name: row.name,
      sortOrder: Number(row.sort_order ?? 0),
      synonyms: (row.synonyms as string[] | null) ?? [],
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
    { title: 'Название', dataIndex: 'name', width: 160 },
    {
      title: 'Синонимы',
      dataIndex: 'synonyms',
      render: (syns: string[] | null) =>
        syns && syns.length > 0
          ? syns.map((s) => <Tag key={s} style={{ marginBottom: 2 }}>{s}</Tag>)
          : <span style={{ color: 'var(--est-text-quaternary)' }}>—</span>,
    },
    { title: 'Порядок', dataIndex: 'sort_order', width: 100, align: 'center' as const },
    {
      title: '',
      width: 140,
      render: (_: unknown, row: Record<string, unknown>) => (
        <Space size={0}>
          <Button type="link" onClick={() => openEdit(row)}>Изменить</Button>
          <Popconfirm title="Удалить единицу?" onConfirm={() => deleteMutation.mutate(row.id as string)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="table-page-wrapper">
      <Space style={{ marginBottom: 16, flexShrink: 0 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={units?.data} loading={isLoading} scroll={{ x: 600, y: 'flex' }} pagination={DEFAULT_PAGINATION} />

      <Modal
        title={editingId ? 'Редактирование единицы' : 'Новая единица измерения'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="м2, шт, компл" />
          </Form.Item>
          <Form.Item
            name="synonyms"
            label="Синонимы"
            tooltip="Варианты записи той же единицы: м², кв.м, шт., штука. Экспорт считает их одной единицей."
          >
            <Select
              mode="tags"
              tokenSeparators={[',', ';']}
              placeholder="м², кв.м"
              open={false}
              suffixIcon={null}
            />
          </Form.Item>
          <Form.Item name="sortOrder" label="Порядок сортировки">
            <InputNumber style={{ width: '100%' }} min={0} step={1} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
