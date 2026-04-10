import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { Form, Input, Button, Card, Typography, App } from 'antd';
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';

const { Title } = Typography;

export function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const { message } = App.useApp();

  async function onFinish(values: { email: string; password: string; fullName: string; phone?: string }) {
    setLoading(true);
    try {
      await register(values.email, values.password, values.fullName, values.phone);
      navigate('/', { replace: true });
    } catch (err) {
      message.error((err as Error).message);
    }
    setLoading(false);
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 400 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>Регистрация</Title>
        <Form onFinish={onFinish} layout="vertical" size="large">
          <Form.Item name="fullName" rules={[{ required: true, min: 2, message: 'Минимум 2 символа' }]}>
            <Input prefix={<UserOutlined />} placeholder="ФИО" />
          </Form.Item>
          <Form.Item name="email" rules={[{ required: true, type: 'email', message: 'Введите email' }]}>
            <Input prefix={<MailOutlined />} placeholder="Email" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, min: 6, message: 'Минимум 6 символов' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Пароль" />
          </Form.Item>
          <Form.Item name="phone">
            <Input placeholder="Телефон (необязательно)" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              Зарегистрироваться
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Link to="/login">Уже есть аккаунт? Войти</Link>
        </div>
      </Card>
    </div>
  );
}
