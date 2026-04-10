import { Outlet, useNavigate, useLocation, Link } from 'react-router';
import { Layout, Menu, Button, Typography, Dropdown } from 'antd';
import {
  FileTextOutlined,
  AppstoreOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';
import type { MenuProps } from 'antd';
import { useMemo } from 'react';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const menuItems = useMemo(() => {
    const items = [
      { key: '/estimates', icon: <FileTextOutlined />, label: 'Сметы' },
      { key: '/references', icon: <AppstoreOutlined />, label: 'Справочники' },
    ];
    if (user?.role === 'admin') {
      items.push({ key: '/administration', icon: <SettingOutlined />, label: 'Администрирование' });
    }
    return items;
  }, [user?.role]);

  const selectedKeys = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/references')) return ['/references'];
    if (path.startsWith('/estimates')) return ['/estimates'];
    if (path.startsWith('/administration')) return ['/administration'];
    if (path.startsWith('/projects')) return ['/references'];
    return [path];
  }, [location.pathname]);

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key);
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Выйти',
      onClick: async () => {
        await logout();
        navigate('/login');
      },
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={240} theme="dark">
        <div style={{ padding: '16px 24px', textAlign: 'center' }}>
          <Link to="/" style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>EstiMat</Link>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKeys}
          items={menuItems}
          onClick={onMenuClick}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Button type="text" icon={<UserOutlined />}>
              <Text>{user?.fullName || user?.email}</Text>
            </Button>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
