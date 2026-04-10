import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { Form, Input, Button, Card, Typography, App } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';

const { Title } = Typography;

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const { message } = App.useApp();

  const returnUrl = searchParams.get('returnUrl');
  const safeUrl = returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/';

  async function onFinish(values: { email: string; password: string }) {
    setLoading(true);
    try {
      await login(values.email, values.password);
      navigate(safeUrl, { replace: true });
    } catch (err) {
      message.error((err as Error).message);
    }
    setLoading(false);
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 400 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>EstiMat</Title>
        <Form onFinish={onFinish} layout="vertical" size="large">
          <Form.Item name="email" rules={[{ required: true, type: 'email', message: 'Введите email' }]}>
            <Input prefix={<MailOutlined />} placeholder="Email" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, min: 6, message: 'Минимум 6 символов' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Пароль" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              Войти
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          <Link to="/register">Регистрация</Link>
        </div>
      </Card>
    </div>
  );
}
