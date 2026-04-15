import { useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, Space, Popconfirm, App } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LockOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { ROLES, ROLE_LABELS } from '@estimat/shared';
import type { Role } from '@estimat/shared';
import type { ColumnsType } from 'antd/es/table';

interface User {
  id: string;
  email: string;
  full_name: string;
  org_id: string | null;
  org_name: string | null;
  role: Role;
  phone: string | null;
  is_active: boolean;
}

const roleColors: Record<string, string> = {
  admin: 'red',
  engineer: 'blue',
  contractor: 'green',
  manager: 'orange',
};

export function UsersPanel() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<User | null>(null);
  const [passwordModal, setPasswordModal] = useState<User | null>(null);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ data: User[] }>('/users'),
  });

  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/organizations'),
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/users', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      closeModal();
      message.success('Пользователь создан');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...values }: Record<string, unknown>) => api.put(`/users/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      closeModal();
      message.success('Пользователь обновлён');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      message.success('Пользователь деактивирован');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const changePasswordMutation = useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      api.put(`/users/${id}/password`, { newPassword }),
    onSuccess: () => {
      setPasswordModal(null);
      passwordForm.resetFields();
      message.success('Пароль изменён');
    },
    onError: (err: Error) => message.error(err.message),
  });

  function closeModal() {
    setModalOpen(false);
    setEditRecord(null);
    form.resetFields();
  }

  function openEdit(record: User) {
    setEditRecord(record);
    form.setFieldsValue({
      email: record.email,
      fullName: record.full_name,
      role: record.role,
      orgId: record.org_id,
      phone: record.phone,
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

  const columns: ColumnsType<User> = [
    { title: 'ФИО', dataIndex: 'full_name' },
    { title: 'Email', dataIndex: 'email', width: 220 },
    {
      title: 'Роль',
      dataIndex: 'role',
      width: 160,
      render: (role: Role) => <Tag color={roleColors[role]}>{ROLE_LABELS[role]}</Tag>,
    },
    { title: 'Организация', dataIndex: 'org_name', width: 200 },
    { title: 'Телефон', dataIndex: 'phone', width: 150 },
    {
      title: 'Активен',
      dataIndex: 'is_active',
      width: 100,
      render: (v: boolean) => v ? <Tag color="green">Да</Tag> : <Tag color="red">Нет</Tag>,
    },
    {
      title: 'Действия',
      width: 150,
      render: (_: unknown, record: User) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Button type="text" icon={<LockOutlined />} onClick={() => setPasswordModal(record)} />
          <Popconfirm title="Деактивировать пользователя?" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="table-page-wrapper">
      <Space style={{ marginBottom: 16, flexShrink: 0 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Добавить</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={usersData?.data} loading={isLoading} scroll={{ y: 'flex' }} />

      {/* Create / Edit modal */}
      <Modal
        title={editRecord ? 'Редактирование пользователя' : 'Новый пользователь'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          {!editRecord && (
            <Form.Item name="password" label="Пароль" rules={[{ required: true, min: 6 }]}>
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item name="fullName" label="ФИО" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          </Form.Item>
          <Form.Item name="orgId" label="Организация">
            <Select
              allowClear
              placeholder="Выберите организацию"
              options={orgsData?.data.map((o) => ({ value: o.id as string, label: o.name as string }))}
            />
          </Form.Item>
          <Form.Item name="phone" label="Телефон">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* Change password modal */}
      <Modal
        title={`Смена пароля: ${passwordModal?.full_name || ''}`}
        open={!!passwordModal}
        onCancel={() => { setPasswordModal(null); passwordForm.resetFields(); }}
        onOk={() => passwordForm.submit()}
        confirmLoading={changePasswordMutation.isPending}
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={(values) => {
            if (passwordModal) {
              changePasswordMutation.mutate({ id: passwordModal.id, newPassword: values.newPassword });
            }
          }}
        >
          <Form.Item name="newPassword" label="Новый пароль" rules={[{ required: true, min: 6, message: 'Минимум 6 символов' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
