import { useState, type CSSProperties } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Select, Space, Popconfirm, Upload, Tag, Tooltip, App } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined, ClearOutlined, SearchOutlined, ApartmentOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { UnitSelect } from '../../components/UnitSelect';
import { CategoriesTypesModal } from './CategoriesTypesModal';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload';

// Вид работ, к которому привязана работа (связь M2M). Один из видов — основной.
interface RateCostType {
  costTypeId: string;
  costTypeName: string;
  categoryId: string;
  categoryName: string;
  isPrimary: boolean;
}

// Состав работы — многострочный текст, в таблице показываем ровно две строки с многоточием
// (полный текст — в подсказке). maxHeight страхует браузеры без line-clamp.
const compositionCell: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  maxHeight: '2.9em',
  whiteSpace: 'pre-wrap',
};

interface Rate {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  price: string;
  /** Состав работы: расшифровка операций, попадает в примечание выгрузки ВОР. */
  description: string | null;
  cost_types: RateCostType[];
  // derived-поля основного вида (для совместимости/сортировки)
  cost_type_id: string | null;
  cost_type_name: string | null;
  category_name: string | null;
}

interface Category { id: string; name: string }
interface CostType { id: string; name: string; category_id: string }

export function RatesPanel() {
  const [modalOpen, setModalOpen] = useState(false);
  const [catTypesOpen, setCatTypesOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<Rate | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [selectedCostTypeId, setSelectedCostTypeId] = useState<string | undefined>();
  const [modalCategoryId, setModalCategoryId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [form] = Form.useForm();
  const watchedTypeIds = (Form.useWatch('costTypeIds', form) as string[] | undefined) ?? [];
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
      return ratesData.data.filter((r) => r.cost_types.some((ct) => ct.costTypeId === selectedCostTypeId));
    }
    if (selectedCategoryId && typesData?.data) {
      const typeIds = new Set(typesData.data.map((t) => t.id));
      return ratesData.data.filter((r) => r.cost_types.some((ct) => typeIds.has(ct.costTypeId)));
    }
    return ratesData.data;
  })();

  // All cost types for create/edit modal
  const { data: allTypesData } = useQuery({
    queryKey: ['rate-types-all'],
    queryFn: () => api.get<{ data: CostType[] }>('/rates/types'),
  });
  const allTypes = allTypesData?.data ?? [];
  const typeName = (id: string) => allTypes.find((t) => t.id === id)?.name ?? id;

  // Опции мультиселекта видов: виды выбранной в модалке категории + уже выбранные
  // (даже из других категорий — чтобы их теги сохраняли подписи). Это и даёт M2M.
  const modalTypeOptions = (() => {
    const base = modalCategoryId ? allTypes.filter((t) => t.category_id === modalCategoryId) : allTypes;
    const map = new Map(base.map((t) => [t.id, { value: t.id, label: t.name }]));
    for (const id of watchedTypeIds) {
      if (!map.has(id)) map.set(id, { value: id, label: typeName(id) });
    }
    return Array.from(map.values());
  })();
  const primaryOptions = watchedTypeIds.map((id) => ({ value: id, label: typeName(id) }));

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/rates', values),
    onSuccess: () => {
      invalidateAll();
      closeModal();
      message.success('Работа добавлена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...values }: Record<string, unknown>) => api.put(`/rates/${id}`, values),
    onSuccess: () => {
      invalidateAll();
      closeModal();
      message.success('Работа обновлена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/rates/${id}`),
    onSuccess: () => {
      invalidateAll();
      message.success('Работа удалена');
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
      message.success(`Импортировано: ${result.imported} работ, ${result.categoriesCreated} категорий, ${result.typesCreated} видов`);
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
    setModalCategoryId(undefined);
    form.resetFields();
  }

  function openCreate() {
    setEditRecord(null);
    setModalCategoryId(undefined);
    form.resetFields();
    setModalOpen(true);
  }

  function openEdit(record: Rate) {
    setEditRecord(record);
    const primary = record.cost_types.find((c) => c.isPrimary) ?? record.cost_types[0];
    setModalCategoryId(primary?.categoryId);
    form.setFieldsValue({
      costTypeIds: record.cost_types.map((c) => c.costTypeId),
      primaryCostTypeId: primary?.costTypeId,
      name: record.name,
      code: record.code ?? '',
      unit: record.unit,
      price: Number(record.price),
      description: record.description ?? '',
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

  // Держим основной вид согласованным с набором: если основной выпал — берём первый.
  function onTypesChange(ids: string[]) {
    const primary = form.getFieldValue('primaryCostTypeId') as string | undefined;
    if (!ids.length) form.setFieldValue('primaryCostTypeId', undefined);
    else if (!primary || !ids.includes(primary)) form.setFieldValue('primaryCostTypeId', ids[0]);
  }

  // Колонка «Код» из таблицы убрана: код заполнен у единиц работ и только съедал ширину.
  // Само поле остаётся в форме — из него собирается наименование вида «[код] Название» в смете.
  const columns: ColumnsType<Rate> = [
    {
      title: 'Наименование',
      key: 'name',
      width: 460,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_: unknown, r: Rate) => (
        <div>
          <div>{r.name}</div>
          {r.cost_types.length > 0 && (
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {r.cost_types.map((ct) => (
                <Tag key={ct.costTypeId} color={ct.isPrimary ? 'blue' : undefined} style={{ marginInlineEnd: 0 }}>
                  {ct.costTypeName}
                </Tag>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Состав работы',
      dataIndex: 'description',
      width: 420,
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v} styles={{ body: { maxWidth: 520, whiteSpace: 'pre-wrap' } }}>
            <div style={compositionCell}>{v}</div>
          </Tooltip>
        ) : null,
    },
    { title: 'Ед. изм.', dataIndex: 'unit', width: 80, sorter: (a, b) => a.unit.localeCompare(b.unit) },
    {
      title: 'Цена, ₽',
      dataIndex: 'price',
      width: 120,
      sorter: (a, b) => Number(a.price) - Number(b.price),
      render: (price: string) => Number(price).toLocaleString('ru-RU'),
    },
    {
      title: 'Действия',
      width: 100,
      render: (_: unknown, record: Rate) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm title="Удалить работу?" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="table-page-wrapper">
      <Space className="estimat-toolbar" style={{ marginBottom: 16, flexShrink: 0 }} wrap>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Категория"
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
          placeholder="Вид работ"
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
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить</Button>
        <Button icon={<ApartmentOutlined />} onClick={() => setCatTypesOpen(true)}>Категории и виды</Button>
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
        scroll={{ x: 1200, y: 'flex' }}
        pagination={DEFAULT_PAGINATION}
      />

      <Modal
        title={editRecord ? 'Редактирование работы' : 'Новая работа'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            label="Категория"
            tooltip="Фильтрует список видов ниже. Можно выбирать виды из разных категорий."
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Все категории"
              value={modalCategoryId}
              onChange={setModalCategoryId}
              options={categoriesData?.data.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item
            name="costTypeIds"
            label="Виды работ"
            rules={[{ required: true, message: 'Выберите хотя бы один вид работ' }]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              placeholder="Выберите виды работ"
              options={modalTypeOptions}
              onChange={onTypesChange}
            />
          </Form.Item>
          <Form.Item name="primaryCostTypeId" label="Основной вид" tooltip="По умолчанию — первый выбранный">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Основной вид"
              disabled={watchedTypeIds.length === 0}
              options={primaryOptions}
            />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="Код">
            <Input />
          </Form.Item>
          <Form.Item name="unit" label="Единица измерения" rules={[{ required: true }]}>
            <UnitSelect />
          </Form.Item>
          <Form.Item name="price" label="Цена">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item
            name="description"
            label="Состав работы"
            tooltip="Расшифровка операций. Печатается в примечании выгрузки ВОР следом за комментариями строки."
          >
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} />
          </Form.Item>
        </Form>
      </Modal>

      <CategoriesTypesModal open={catTypesOpen} onClose={() => setCatTypesOpen(false)} />
    </div>
  );
}
