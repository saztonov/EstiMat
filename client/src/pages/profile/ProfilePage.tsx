import { useState } from 'react';
import { Card, Descriptions, Button, Modal, Form, Input, App } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();

  const changePasswordMutation = useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      api.post('/auth/change-password', values),
    onSuccess: () => {
      setPasswordOpen(false);
      form.resetFields();
      message.success('Пароль изменён');
    },
    onError: (err: Error) => message.error(err.message),
  });

  return (
    <Card title="Личный кабинет" style={{ maxWidth: 640 }}>
      <Descriptions
        column={1}
        bordered
        size="middle"
        items={[
          { key: 'fullName', label: 'ФИО', children: user?.fullName || '—' },
          { key: 'email', label: 'Email', children: user?.email || '—' },
        ]}
      />

      <Button
        type="primary"
        icon={<LockOutlined />}
        style={{ marginTop: 24 }}
        onClick={() => setPasswordOpen(true)}
      >
        Изменить пароль
      </Button>

      <Modal
        title="Изменить пароль"
        open={passwordOpen}
        onCancel={() => {
          setPasswordOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={changePasswordMutation.isPending}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            changePasswordMutation.mutate({
              currentPassword: values.currentPassword,
              newPassword: values.newPassword,
            })
          }
        >
          <Form.Item
            name="currentPassword"
            label="Текущий пароль"
            rules={[{ required: true, message: 'Введите текущий пароль' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="Новый пароль"
            rules={[{ required: true, min: 6, message: 'Минимум 6 символов' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="Повторите новый пароль"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Повторите новый пароль' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Пароли не совпадают'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
