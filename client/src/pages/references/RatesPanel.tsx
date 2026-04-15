import { useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Select, Space, Popconfirm, Upload, App } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined, ClearOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload';

interface Rate {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  price: string;
  description: string | null;
  cost_type_id: string;
  cost_type_name: string;
  category_name: string;
}

interface Category { id: string; name: string }
interface CostType { id: string; name: string; category_id: string }

export function RatesPanel() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<Rate | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [selectedCostTypeId, setSelectedCostTypeId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  // Fetch categories
  const { data: categoriesData } = useQuery({
    queryKey: ['rate-categories'],
    queryFn: () => api.get<{ data: Category[] }>('/rates/categories'),
  });

  // Fetch cost types (filtered by category if selected)
  const { data: typesData } = useQuery({
    queryKey: ['rate-types', selectedCategoryId],
    queryFn: () => api.get<{ data: CostType[] }>(
      selectedCategoryId ? `/rates/types?categoryId=${selectedCategoryId}` : '/rates/types',
    ),
  });

  // Fetch ALL rates once; filtering/search on client
  const { data: ratesData, isLoading } = useQuery({
    queryKey: ['rates'],
    queryFn: () => api.get<{ data: Rate[] }>('/rates'),
  });

  // Фильтрация на клиенте: поиск по названию игнорирует фильтры категории/вида,
  // работает по всем загруженным расценкам (как требовал пользователь).
  const filteredRates = (() => {
    if (!ratesData?.data) return [];
    const searchTrimmed = search.trim().toLowerCase();
    if (searchTrimmed) {
      return ratesData.data.filter((r) => r.name.toLowerCase().includes(searchTrimmed));
    }
    if (selectedCostTypeId) {
      return ratesData.data.filter((r) => r.cost_type_id === selectedCostTypeId);
    }
    if (selectedCategoryId && typesData?.data) {
      const typeIds = new Set(typesData.data.map((t) => t.id));
      return ratesData.data.filter((r) => typeIds.has(r.cost_type_id));
    }
    return ratesData.data;
  })();

  // All cost types for create/edit modal
  const { data: allTypesData } = useQuery({
    queryKey: ['rate-types-all'],
    queryFn: () => api.get<{ data: CostType[] }>('/rates/types'),
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/rates', values),
    onSuccess: () => {
      invalidateAll();
      closeModal();
      message.success('Расценка добавлена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...values }: Record<string, unknown>) => api.put(`/rates/${id}`, values),
    onSuccess: () => {
      invalidateAll();
      closeModal();
      message.success('Расценка обновлена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/rates/${id}`),
    onSuccess: () => {
      invalidateAll();
      message.success('Расценка удалена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const importMutation = useMutation({
    mutationFn: (file: UploadFile) => {
      const formData = new FormData();
      formData.append('file', file as unknown as Blob);
      return api.upload<{ imported: number; categoriesCreated: number; typesCreated: number }>('/rates/import', formData);
    },
    onSuccess: (result) => {
      invalidateAll();
      message.success(`Импортировано: ${result.imported} расценок, ${result.categoriesCreated} категорий, ${result.typesCreated} видов`);
    },
    onError: (err: Error) => message.error(err.message),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['rates'] });
    queryClient.invalidateQueries({ queryKey: ['rate-categories'] });
    queryClient.invalidateQueries({ queryKey: ['rate-types'] });
    queryClient.invalidateQueries({ queryKey: ['rate-types-all'] });
    queryClient.invalidateQueries({ queryKey: ['rates-tree'] });
  }

  function closeModal() {
    setModalOpen(false);
    setEditRecord(null);
    form.resetFields();
  }

  function openEdit(record: Rate) {
    setEditRecord(record);
    form.setFieldsValue({
      costTypeId: record.cost_type_id,
      name: record.name,
      code: record.code,
      unit: record.unit,
      price: Number(record.price),
      description: record.description,
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

  const columns: ColumnsType<Rate> = [
    { title: 'Код', dataIndex: 'code', width: 100, sorter: (a, b) => (a.code || '').localeCompare(b.code || '') },
    { title: 'Название', dataIndex: 'name', width: 400, sorter: (a, b) => a.name.localeCompare(b.name) },
    { title: 'Ед. изм.', dataIndex: 'unit', width: 80, sorter: (a, b) => a.unit.localeCompare(b.unit) },
    {
      title: 'Цена, \u20BD',
      dataIndex: 'price',
      width: 120,
      sorter: (a, b) => Number(a.price) - Number(b.price),
      render: (price: string) => Number(price).toLocaleString('ru-RU'),
    },
    { title: 'Вид затрат', dataIndex: 'cost_type_name', width: 200, sorter: (a, b) => a.cost_type_name.localeCompare(b.cost_type_name) },
    { title: 'Категория', dataIndex: 'category_name', width: 200, sorter: (a, b) => a.category_name.localeCompare(b.category_name) },
    {
      title: 'Действия',
      width: 100,
      render: (_: unknown, record: Rate) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm title="Удалить расценку?" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="table-page-wrapper">
      <Space style={{ marginBottom: 16, flexShrink: 0 }} wrap>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Категория затрат"
          style={{ width: 250 }}
          value={selectedCategoryId}
          onChange={(val) => {
            setSelectedCategoryId(val);
            setSelectedCostTypeId(undefined);
          }}
          options={categoriesData?.data.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Вид затрат"
          style={{ width: 250 }}
          value={selectedCostTypeId}
          onChange={setSelectedCostTypeId}
          disabled={!selectedCategoryId}
          options={typesData?.data.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Button
          icon={<ClearOutlined />}
          disabled={!selectedCategoryId && !selectedCostTypeId}
          onClick={() => { setSelectedCategoryId(undefined); setSelectedCostTypeId(undefined); }}
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Поиск по названию"
          style={{ width: 300 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Добавить</Button>
        <Upload
          accept=".xlsx"
          showUploadList={false}
          beforeUpload={(file) => {
            importMutation.mutate(file as unknown as UploadFile);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={importMutation.isPending}>Импорт Excel</Button>
        </Upload>
      </Space>

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={filteredRates}
        loading={isLoading}
        scroll={{ y: 'flex' }}
        pagination={{ pageSize: 50, showSizeChanger: false }}
      />

      <Modal
        title={editRecord ? 'Редактирование расценки' : 'Новая расценка'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          {!editRecord && (
            <Form.Item name="costTypeId" label="Вид затрат" rules={[{ required: true, message: 'Выберите вид затрат' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Выберите вид затрат"
                options={allTypesData?.data.map((t) => ({ value: t.id, label: t.name }))}
              />
            </Form.Item>
          )}
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="Код">
            <Input />
          </Form.Item>
          <Form.Item name="unit" label="Единица измерения" rules={[{ required: true }]}>
            <Input placeholder="м, шт, кг" />
          </Form.Item>
          <Form.Item name="price" label="Цена" rules={[{ required: true, type: 'number', min: 0 }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
