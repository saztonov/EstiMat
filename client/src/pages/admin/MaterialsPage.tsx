import { useState } from 'react';
import { Table, Button, Card, Modal, Form, Input, Select, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';

export function MaterialsPage() {
  const [modalOpen, setModalOpen] = useState(false);
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
      setModalOpen(false);
      form.resetFields();
      message.success('Материал добавлен');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const columns = [
    { title: 'Название', dataIndex: 'name' },
    { title: 'Группа', dataIndex: 'group_name', width: 200 },
    { title: 'Ед. изм.', dataIndex: 'unit', width: 100 },
    { title: 'Описание', dataIndex: 'description', ellipsis: true },
  ];

  return (
    <Card
      title="Справочник материалов"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Добавить</Button>}
    >
      <Table rowKey="id" columns={columns} dataSource={materials?.data} loading={isLoading} />

      <Modal
        title="Новый материал"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMutation.mutate(v)}>
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
          <Form.Item name="description" label="Описание">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
