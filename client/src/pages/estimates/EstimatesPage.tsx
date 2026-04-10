import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Table, Button, Card, Tag, Modal, Form, Input, Select, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { ESTIMATE_STATUS_LABELS } from '@estimat/shared';

const statusColors: Record<string, string> = {
  draft: 'default',
  review: 'blue',
  approved: 'green',
  archived: 'orange',
};

export function EstimatesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['estimates', projectId],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>(`/estimates${projectId ? `?projectId=${projectId}` : ''}`),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/projects'),
  });

  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/organizations'),
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/estimates', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      setModalOpen(false);
      form.resetFields();
      message.success('Смета создана');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const columns = [
    { title: 'Проект', dataIndex: 'project_code', width: 100 },
    { title: 'Объект', dataIndex: 'project_name' },
    { title: 'Подрядчик', dataIndex: 'contractor_name', render: (v: string) => v || '—' },
    { title: 'Вид работ', dataIndex: 'work_type', render: (v: string) => v || '—' },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 130,
      render: (s: string) => <Tag color={statusColors[s]}>{ESTIMATE_STATUS_LABELS[s as keyof typeof ESTIMATE_STATUS_LABELS]}</Tag>,
    },
    {
      title: 'Сумма',
      dataIndex: 'total_amount',
      width: 140,
      render: (v: string) => `${Number(v).toLocaleString('ru-RU')} ₽`,
    },
  ];

  return (
    <Card
      title={projectId ? 'Сметы проекта' : 'Все сметы'}
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Создать</Button>}
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data?.data}
        loading={isLoading}
        onRow={(record) => ({ onClick: () => navigate(`/estimates/${record.id}`) })}
        style={{ cursor: 'pointer' }}
      />

      <Modal
        title="Новая смета"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMutation.mutate(v)} initialValues={{ projectId: projectId || undefined }}>
          <Form.Item name="projectId" label="Проект" rules={[{ required: true }]}>
            <Select
              placeholder="Выберите проект"
              options={projects?.data.map((p) => ({ value: p.id as string, label: `${p.code} — ${p.name}` }))}
            />
          </Form.Item>
          <Form.Item name="contractorId" label="Подрядчик">
            <Select
              allowClear
              placeholder="Выберите подрядчика"
              options={orgs?.data.filter((o) => o.type === 'subcontractor').map((o) => ({ value: o.id as string, label: o.name as string }))}
            />
          </Form.Item>
          <Form.Item name="workType" label="Вид работ">
            <Input />
          </Form.Item>
          <Form.Item name="notes" label="Примечания">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
