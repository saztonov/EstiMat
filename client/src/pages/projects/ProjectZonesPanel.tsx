import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Popconfirm, Space, Tag, Divider, Typography, App,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useProjectZones, useRoomTypes, useProjectRoomTypes } from '../../hooks/useProjectLocations';
import { type ZoneNode, type ZoneKind, ZONE_KIND_LABEL, formatFloorRange } from '../estimates/components/location';

const KIND_OPTIONS = (Object.keys(ZONE_KIND_LABEL) as ZoneKind[]).map((k) => ({ value: k, label: ZONE_KIND_LABEL[k] }));

interface Props {
  projectId: string;
}

// Настройка локаций объекта: дерево зон (корпуса/парковка/стилобат) + активные типы помещений.
export function ProjectZonesPanel({ projectId }: Props) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: zonesData, isLoading } = useProjectZones(projectId);
  const { data: allRoomTypes } = useRoomTypes();
  const { data: activeRoomTypes } = useProjectRoomTypes(projectId);

  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  useEffect(() => {
    if (activeRoomTypes?.data) setSelectedTypes(activeRoomTypes.data.map((rt) => rt.id));
  }, [activeRoomTypes]);

  const invalidateZones = () => queryClient.invalidateQueries({ queryKey: ['project-zones', projectId] });

  const createZone = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post(`/projects/${projectId}/zones`, values),
    onSuccess: () => { invalidateZones(); closeModal(); message.success('Зона добавлена'); },
    onError: (e: Error) => message.error(e.message),
  });

  const updateZone = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) =>
      api.put(`/projects/${projectId}/zones/${id}`, values),
    onSuccess: () => {
      invalidateZones();
      // Этажность могла измениться — строки сметы могут оказаться вне диапазона.
      queryClient.invalidateQueries({ queryKey: ['project-estimate', projectId] });
      closeModal();
      message.success('Зона обновлена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteZone = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/zones/${id}`),
    onSuccess: () => {
      invalidateZones();
      queryClient.invalidateQueries({ queryKey: ['project-estimate', projectId] });
      message.success('Зона удалена');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const saveTypes = useMutation({
    mutationFn: (roomTypeIds: string[]) => api.put(`/projects/${projectId}/room-types`, { roomTypeIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-room-types', projectId] });
      message.success('Типы помещений сохранены');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const openCreate = (parentId: string | null) => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ kind: 'building', parentId, sortOrder: 0 });
    setModalOpen(true);
  };

  const openEdit = (z: ZoneNode) => {
    setEditingId(z.id);
    form.setFieldsValue({
      parentId: z.parent_id,
      name: z.name,
      kind: z.kind,
      code: z.code ?? undefined,
      floorMin: z.floor_min ?? undefined,
      floorMax: z.floor_max ?? undefined,
      sortOrder: z.sort_order,
    });
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditingId(null); form.resetFields(); };

  const onSubmit = (values: Record<string, unknown>) => {
    if (editingId) updateZone.mutate({ id: editingId, values });
    else createZone.mutate(values);
  };

  const columns = [
    { title: 'Название', dataIndex: 'name' },
    {
      title: 'Тип',
      dataIndex: 'kind',
      width: 130,
      render: (k: ZoneKind) => <Tag>{ZONE_KIND_LABEL[k]}</Tag>,
    },
    {
      title: 'Этажность',
      width: 130,
      render: (_: unknown, z: ZoneNode) => formatFloorRange(z.floor_min, z.floor_max) || '—',
    },
    {
      title: '',
      width: 220,
      render: (_: unknown, z: ZoneNode) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openCreate(z.id)}>+ внутри</Button>
          <Button type="link" size="small" onClick={() => openEdit(z)}>Изменить</Button>
          <Popconfirm
            title="Удалить зону?"
            description="Строки сметы этой зоны станут «без локации»."
            onConfirm={() => deleteZone.mutate(z.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(null)}>Добавить зону</Button>
      </Space>
      <Table<ZoneNode>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={zonesData?.data.roots ?? []}
        loading={isLoading}
        pagination={false}
        expandable={{ defaultExpandAllRows: true }}
      />

      <Divider />
      <Typography.Title level={5}>Типы помещений объекта</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        Выберите типы, доступные при наборе сметы этого объекта. Если не выбрано — доступны все активные.
      </Typography.Paragraph>
      <Space.Compact style={{ width: '100%' }}>
        <Select
          mode="multiple"
          allowClear
          style={{ flex: 1 }}
          placeholder="Типы помещений"
          value={selectedTypes}
          onChange={setSelectedTypes}
          optionFilterProp="label"
          options={(allRoomTypes?.data ?? []).map((rt) => ({ value: rt.id, label: rt.name }))}
        />
        <Button type="primary" loading={saveTypes.isPending} onClick={() => saveTypes.mutate(selectedTypes)}>
          Сохранить
        </Button>
      </Space.Compact>

      <Modal
        title={editingId ? 'Редактирование зоны' : 'Новая зона'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createZone.isPending || updateZone.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="parentId" hidden><Input /></Form.Item>
          <Form.Item name="kind" label="Тип зоны" rules={[{ required: true }]}>
            <Select options={KIND_OPTIONS} />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Корпус 2, Подземная парковка, Стилобат" />
          </Form.Item>
          <Form.Item name="code" label="Код (необязательно)">
            <Input placeholder="напр. К2" />
          </Form.Item>
          <Space>
            <Form.Item name="floorMin" label="Этаж с" tooltip="Подземные — отрицательные">
              <InputNumber style={{ width: 120 }} step={1} />
            </Form.Item>
            <Form.Item name="floorMax" label="Этаж по">
              <InputNumber style={{ width: 120 }} step={1} />
            </Form.Item>
          </Space>
          <Form.Item name="sortOrder" label="Порядок сортировки">
            <InputNumber style={{ width: '100%' }} step={1} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
