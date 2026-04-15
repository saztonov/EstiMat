import { useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router';
import { Layout, Menu, Button, Typography, Dropdown } from 'antd';
import {
  FileTextOutlined,
  AppstoreOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';
import type { MenuProps } from 'antd';
import { useMemo } from 'react';

const { Sider, Content } = Layout;
const { Text } = Typography;

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

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
      <Sider
        width={240}
        collapsedWidth={64}
        theme="dark"
        collapsed={collapsed}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ padding: collapsed ? '16px 0' : '16px 24px', textAlign: 'center' }}>
            <Link to="/" style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>
              {collapsed ? 'E' : 'EstiMat'}
            </Link>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={selectedKeys}
            items={menuItems}
            onClick={onMenuClick}
            style={{ flex: 1, borderRight: 0 }}
          />
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: collapsed ? '8px 0' : '8px 16px' }}>
            <Dropdown menu={{ items: userMenuItems }} placement="topRight" trigger={['click']}>
              <Button
                type="text"
                icon={<UserOutlined />}
                style={{
                  color: 'rgba(255,255,255,0.85)',
                  width: '100%',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  gap: 8,
                }}
              >
                {!collapsed && <Text style={{ color: 'rgba(255,255,255,0.85)' }} ellipsis>{user?.fullName || user?.email}</Text>}
              </Button>
            </Dropdown>
          </div>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{
              color: 'rgba(255,255,255,0.65)',
              width: '100%',
              borderRadius: 0,
              borderTop: '1px solid rgba(255,255,255,0.1)',
              height: 48,
            }}
          />
        </div>
      </Sider>
      <Layout>
        <Content style={{ margin: 24, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
