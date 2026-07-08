import { useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, Space, Popconfirm, Tooltip, App } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { ORG_TYPE_LABELS, ORG_TYPES } from '@estimat/shared';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';

export function OrganizationsPanel() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  // Модалка назначения объектов подрядчику.
  const [projectsOrg, setProjectsOrg] = useState<Record<string, unknown> | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/organizations'),
  });

  // Список объектов для выбора в модалке «Объекты».
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/projects'),
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/organizations', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      closeModal();
      message.success('Организация создана');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...values }: Record<string, unknown>) => api.put(`/organizations/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      closeModal();
      message.success('Организация обновлена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      message.success('Организация деактивирована');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const saveProjectsMutation = useMutation({
    mutationFn: ({ id, projectIds }: { id: string; projectIds: string[] }) =>
      api.put(`/organizations/${id}/projects`, { projectIds }),
    onSuccess: () => {
      setProjectsOrg(null);
      message.success('Объекты сохранены');
    },
    onError: (err: Error) => message.error(err.message),
  });

  // Только подрядчикам (суб-/генподрядчик) можно назначать объекты.
  const isContractorOrg = (type: unknown) => type === 'subcontractor' || type === 'general_contractor';

  async function openProjects(record: Record<string, unknown>) {
    setProjectsOrg(record);
    setSelectedProjects([]);
    const res = await api.get<{ data: string[] }>(`/organizations/${record.id}/projects`);
    setSelectedProjects(res.data);
  }

  function closeModal() {
    setModalOpen(false);
    setEditRecord(null);
    form.resetFields();
  }

  function openEdit(record: Record<string, unknown>) {
    setEditRecord(record);
    form.setFieldsValue({
      name: record.name,
      inn: record.inn,
      type: record.type,
      address: record.address,
      alternative_names: (record.alternative_names as string[]) ?? [],
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
    {
      title: 'Действия',
      width: 150,
      render: (_: unknown, record: Record<string, unknown>) => (
        <Space>
          {isContractorOrg(record.type) && (
            <Tooltip title="Объекты подрядчика">
              <Button type="text" icon={<AppstoreOutlined />} onClick={(e) => { e.stopPropagation(); openProjects(record); }} />
            </Tooltip>
          )}
          <Button type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); openEdit(record); }} />
          <Popconfirm title="Деактивировать организацию?" onConfirm={() => deleteMutation.mutate(record.id as string)} onPopupClick={(e) => e.stopPropagation()}>
            <Button type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // Клиентская фильтрация: поиск по названию и ИНН + отбор по типу.
  const searchTrimmed = search.trim().toLowerCase();
  const filtered = (data?.data ?? []).filter((org) => {
    if (typeFilter && org.type !== typeFilter) return false;
    if (searchTrimmed) {
      const name = String(org.name ?? '').toLowerCase();
      const inn = String(org.inn ?? '').toLowerCase();
      if (!name.includes(searchTrimmed) && !inn.includes(searchTrimmed)) return false;
    }
    return true;
  });

  return (
    <div className="table-page-wrapper">
      <Space className="estimat-toolbar" style={{ marginBottom: 16, flexShrink: 0 }} wrap>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Поиск по названию или ИНН"
          style={{ width: 300 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          allowClear
          placeholder="Тип"
          style={{ width: 200 }}
          value={typeFilter}
          onChange={setTypeFilter}
          options={ORG_TYPES.map((t) => ({ value: t, label: ORG_TYPE_LABELS[t] }))}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Создать</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={filtered} loading={isLoading} scroll={{ x: 800, y: 'flex' }} pagination={DEFAULT_PAGINATION} />

      <Modal
        title={editRecord ? 'Редактирование организации' : 'Новая организация'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
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
          <Form.Item name="alternative_names" label="Альтернативные наименования">
            <Select mode="tags" tokenSeparators={[',']} open={false} placeholder="Введите и нажмите Enter" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Объекты подрядчика: ${String(projectsOrg?.name ?? '')}`}
        open={!!projectsOrg}
        onCancel={() => setProjectsOrg(null)}
        onOk={() => projectsOrg && saveProjectsMutation.mutate({ id: projectsOrg.id as string, projectIds: selectedProjects })}
        confirmLoading={saveProjectsMutation.isPending}
      >
        <p style={{ color: '#8c8c8c', marginTop: 0 }}>
          Подрядчик увидит в личном кабинете только назначенные объекты.
        </p>
        <Select
          mode="multiple"
          allowClear
          showSearch
          style={{ width: '100%' }}
          placeholder="Выберите объекты"
          value={selectedProjects}
          onChange={setSelectedProjects}
          optionFilterProp="label"
          options={(projectsData?.data ?? []).map((p) => ({
            value: p.id as string,
            label: `${String(p.code ?? '')} · ${String(p.name ?? '')}`,
          }))}
        />
      </Modal>
    </div>
  );
}
