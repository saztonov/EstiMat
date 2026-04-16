import { useMemo, useState } from 'react';
import { Table, Button, Tag, Modal, Form, Input, Select, Space, App, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
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

interface CostCategory {
  id: string;
  name: string;
}

export function ProjectEstimatesTab({ projectId }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['estimates', projectId],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>(`/estimates?projectId=${projectId}`),
  });

  const { data: categories } = useQuery({
    queryKey: ['rate-categories'],
    queryFn: () => api.get<{ data: CostCategory[] }>('/rates/categories'),
  });

  const filteredData = useMemo(() => {
    const list = data?.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((row) => {
      if (categoryFilter && row.cost_category_id !== categoryFilter) return false;
      if (q && !String(row.work_type ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data?.data, search, categoryFilter]);

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api.post('/estimates', { ...values, projectId }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['estimates', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['project-summary', projectId] });
      setModalOpen(false);
      form.resetFields();
      message.success('Смета создана');
      const created = (result as { data?: { id?: string } })?.data;
      if (created?.id) navigate(`/estimates/${created.id}`);
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (estimateId: string) => api.delete(`/estimates/${estimateId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['project-summary', projectId] });
      message.success('Смета удалена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const columns = [
    {
      title: 'Работы',
      dataIndex: 'work_type',
      render: (v: string) => v || '—',
    },
    {
      title: 'Категория затрат',
      dataIndex: 'cost_category_name',
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
    {
      title: '',
      width: 60,
      render: (_v: unknown, r: Record<string, unknown>) => (
        <Popconfirm
          title="Удалить смету?"
          description="Все разделы и позиции будут удалены."
          onConfirm={(e) => {
            e?.stopPropagation();
            deleteMutation.mutate(r.id as string);
          }}
          onCancel={(e) => e?.stopPropagation()}
        >
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={(e) => e.stopPropagation()}
          />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div className="table-page-wrapper">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          gap: 12,
          flexShrink: 0,
        }}
      >
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Создать смету
        </Button>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Поиск по работам"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Категория затрат"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categories?.data.map((c) => ({ value: c.id, label: c.name }))}
            style={{ width: 240 }}
          />
        </Space>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={filteredData}
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
          <Form.Item
            name="costCategoryId"
            label="Категория затрат"
            rules={[{ required: true, message: 'Выберите категорию затрат' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Выберите категорию затрат"
              options={categories?.data.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item name="workType" label="Работы">
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
