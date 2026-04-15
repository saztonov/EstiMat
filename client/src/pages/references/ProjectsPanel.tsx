import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Table, Button, Modal, Form, Input, Select, Tag, Space, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { PROJECT_STATUS_LABELS } from '@estimat/shared';
import type { ColumnsType } from 'antd/es/table';

const statusColors: Record<string, string> = {
  planning: 'blue',
  active: 'green',
  completed: 'default',
  archived: 'orange',
};

export function ProjectsPanel() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/projects'),
  });

  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/organizations'),
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/projects', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setModalOpen(false);
      form.resetFields();
      message.success('Проект создан');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const columns: ColumnsType<Record<string, unknown>> = [
    { title: 'Код', dataIndex: 'code', width: 100 },
    { title: 'Название', dataIndex: 'name' },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 140,
      render: (status: string) => (
        <Tag color={statusColors[status]}>{PROJECT_STATUS_LABELS[status as keyof typeof PROJECT_STATUS_LABELS] || status}</Tag>
      ),
    },
    { title: 'Адрес', dataIndex: 'address', ellipsis: true },
  ];

  return (
    <div className="table-page-wrapper">
      <Space style={{ marginBottom: 16, flexShrink: 0 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Создать</Button>
      </Space>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data?.data}
        loading={isLoading}
        scroll={{ y: 'flex' }}
        onRow={(record) => ({ onClick: () => navigate(`/projects/${record.id}`) })}
        style={{ cursor: 'pointer' }}
      />

      <Modal
        title="Новый проект"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMutation.mutate(v)}>
          <Form.Item name="code" label="Код (3-6 символов)" rules={[{ required: true, min: 3, max: 6 }]}>
            <Input placeholder="СОБ62" />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="ЖК Солнечный" />
          </Form.Item>
          <Form.Item name="fullName" label="Полное название">
            <Input />
          </Form.Item>
          <Form.Item name="orgId" label="Организация" rules={[{ required: true }]}>
            <Select
              placeholder="Выберите организацию"
              options={orgs?.data.map((o) => ({ value: o.id as string, label: o.name as string }))}
            />
          </Form.Item>
          <Form.Item name="address" label="Адрес">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
