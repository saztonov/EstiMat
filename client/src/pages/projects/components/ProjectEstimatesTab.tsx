import { useState } from 'react';
import { Table, Button, Tag, Modal, Form, Input, Select, Space, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { ESTIMATE_STATUS_LABELS } from '@estimat/shared';

const statusColors: Record<string, string> = {
  draft: 'default',
  review: 'blue',
  approved: 'green',
  archived: 'orange',
};

interface Props {
  projectId: string;
}

export function ProjectEstimatesTab({ projectId }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['estimates', projectId],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>(`/estimates?projectId=${projectId}`),
  });

  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/organizations'),
    enabled: modalOpen,
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api.post('/estimates', { ...values, projectId }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['estimates', projectId] });
      setModalOpen(false);
      form.resetFields();
      message.success('Смета создана');
      const created = (result as { data?: { id?: string } })?.data;
      if (created?.id) navigate(`/estimates/${created.id}`);
    },
    onError: (e: Error) => message.error(e.message),
  });

  const columns = [
    {
      title: 'Вид работ',
      dataIndex: 'work_type',
      render: (v: string) => v || '—',
    },
    {
      title: 'Подрядчик',
      dataIndex: 'contractor_name',
      render: (v: string) => v || '—',
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 130,
      render: (s: string) => <Tag color={statusColors[s]}>{ESTIMATE_STATUS_LABELS[s as keyof typeof ESTIMATE_STATUS_LABELS]}</Tag>,
    },
    {
      title: 'Сумма',
      dataIndex: 'total_amount',
      width: 160,
      align: 'right' as const,
      render: (v: string) => `${Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`,
    },
    {
      title: 'Создана',
      dataIndex: 'created_at',
      width: 130,
      render: (v: string) => new Date(v).toLocaleDateString('ru-RU'),
    },
  ];

  return (
    <div className="table-page-wrapper">
      <Space style={{ marginBottom: 16, flexShrink: 0 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Создать смету
        </Button>
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data?.data}
        loading={isLoading}
        scroll={{ y: 'flex' }}
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
        <Form form={form} layout="vertical" onFinish={(v) => createMutation.mutate(v)}>
          <Form.Item name="contractorId" label="Подрядчик">
            <Select
              allowClear
              placeholder="Выберите подрядчика"
              options={orgs?.data
                .filter((o) => o.type === 'subcontractor')
                .map((o) => ({ value: o.id as string, label: o.name as string }))}
            />
          </Form.Item>
          <Form.Item name="workType" label="Вид работ">
            <Input placeholder="Например: Отделка, Черновые работы" />
          </Form.Item>
          <Form.Item name="notes" label="Примечания">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
