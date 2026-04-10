import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Card, Table, Button, Tag, Descriptions, Modal, Form, Input, InputNumber, Select, Space, Popconfirm, App, Spin } from 'antd';
import { ArrowLeftOutlined, PlusOutlined, CheckOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { ESTIMATE_STATUS_LABELS } from '@estimat/shared';

interface EstimateItem {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total: string;
  sort_order: number;
  rate_name: string | null;
  rate_code: string | null;
}

interface EstimateDetail {
  id: string;
  project_code: string;
  project_name: string;
  contractor_name: string | null;
  work_type: string | null;
  status: string;
  total_amount: string;
  notes: string | null;
  items: EstimateItem[];
}

export function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['estimate', id],
    queryFn: () => api.get<{ data: EstimateDetail }>(`/estimates/${id}`),
  });

  const { data: rates } = useQuery({
    queryKey: ['rates'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/rates'),
  });

  const addItemMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post(`/estimates/${id}/items`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
      setModalOpen(false);
      form.resetFields();
      message.success('Позиция добавлена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => api.delete(`/estimates/items/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
      message.success('Позиция удалена');
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/estimates/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', id] });
      message.success('Статус обновлён');
    },
    onError: (err: Error) => message.error(err.message),
  });

  if (isLoading) return <Spin size="large" />;

  const estimate = data?.data;
  if (!estimate) return <div>Смета не найдена</div>;

  const isDraft = estimate.status === 'draft';

  const columns = [
    { title: '#', dataIndex: 'sort_order', width: 50 },
    {
      title: 'Расценка',
      dataIndex: 'rate_code',
      width: 100,
      render: (_: unknown, record: EstimateItem) => record.rate_code || '—',
    },
    { title: 'Описание', dataIndex: 'description' },
    { title: 'Кол-во', dataIndex: 'quantity', width: 100, render: (v: string) => Number(v) },
    { title: 'Ед.', dataIndex: 'unit', width: 70 },
    { title: 'Цена', dataIndex: 'unit_price', width: 120, render: (v: string) => `${Number(v).toLocaleString('ru-RU')} ₽` },
    { title: 'Итого', dataIndex: 'total', width: 140, render: (v: string) => `${Number(v).toLocaleString('ru-RU')} ₽` },
    ...(isDraft
      ? [{
          title: '',
          width: 50,
          render: (_: unknown, record: EstimateItem) => (
            <Popconfirm title="Удалить позицию?" onConfirm={() => deleteItemMutation.mutate(record.id)}>
              <Button type="text" danger icon={<DeleteOutlined />} size="small" />
            </Popconfirm>
          ),
        }]
      : []),
  ];

  function onRateSelect(rateId: string) {
    const rate = rates?.data.find((r) => r.id === rateId) as Record<string, unknown> | undefined;
    if (rate) {
      form.setFieldsValue({
        description: rate.name,
        unit: rate.unit,
        unitPrice: Number(rate.price),
      });
    }
  }

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        Назад
      </Button>

      <Card
        title={`Смета: ${estimate.project_code} — ${estimate.work_type || 'Без типа'}`}
        extra={
          <Space>
            {isDraft && (
              <Button type="primary" icon={<CheckOutlined />} onClick={() => statusMutation.mutate('review')}>
                На проверку
              </Button>
            )}
            {estimate.status === 'review' && (
              <Button type="primary" icon={<CheckOutlined />} onClick={() => statusMutation.mutate('approved')}>
                Утвердить
              </Button>
            )}
          </Space>
        }
      >
        <Descriptions column={3} style={{ marginBottom: 24 }}>
          <Descriptions.Item label="Проект">{estimate.project_code} — {estimate.project_name}</Descriptions.Item>
          <Descriptions.Item label="Подрядчик">{estimate.contractor_name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Статус">
            <Tag>{ESTIMATE_STATUS_LABELS[estimate.status as keyof typeof ESTIMATE_STATUS_LABELS]}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Итого">
            <strong>{Number(estimate.total_amount).toLocaleString('ru-RU')} ₽</strong>
          </Descriptions.Item>
          <Descriptions.Item label="Примечания">{estimate.notes || '—'}</Descriptions.Item>
        </Descriptions>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h4>Позиции сметы</h4>
          {isDraft && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              Добавить позицию
            </Button>
          )}
        </div>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={estimate.items}
          pagination={false}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6} align="right"><strong>ИТОГО:</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={6}>
                <strong>{Number(estimate.total_amount).toLocaleString('ru-RU')} ₽</strong>
              </Table.Summary.Cell>
              {isDraft && <Table.Summary.Cell index={7} />}
            </Table.Summary.Row>
          )}
        />
      </Card>

      <Modal
        title="Добавить позицию"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={addItemMutation.isPending}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={(v) => addItemMutation.mutate(v)}>
          <Form.Item name="rateId" label="Расценка (необязательно)">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Выберите расценку"
              options={rates?.data.map((r) => ({
                value: r.id as string,
                label: `${r.code ? `[${r.code}] ` : ''}${r.name} — ${r.unit} — ${Number(r.price).toLocaleString('ru-RU')} ₽`,
              }))}
              onChange={onRateSelect}
            />
          </Form.Item>
          <Form.Item name="description" label="Описание" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="quantity" label="Количество" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unit" label="Единица измерения" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="unitPrice" label="Цена за единицу" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} addonAfter="₽" />
          </Form.Item>
          <Form.Item name="sortOrder" label="Порядок" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
