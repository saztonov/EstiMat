import { useState } from 'react';
import { Table, Button, Card, Modal, Form, Input, Select, Tag, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { ORG_TYPE_LABELS, ORG_TYPES } from '@estimat/shared';

export function OrganizationsPage() {
  const [modalOpen, setModalOpen] = useState(false);
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
      setModalOpen(false);
      form.resetFields();
      message.success('Организация создана');
    },
    onError: (err: Error) => message.error(err.message),
  });

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
  ];

  return (
    <Card
      title="Организации"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Создать</Button>}
    >
      <Table rowKey="id" columns={columns} dataSource={data?.data} loading={isLoading} />

      <Modal
        title="Новая организация"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMutation.mutate(v)}>
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
    </Card>
  );
}
