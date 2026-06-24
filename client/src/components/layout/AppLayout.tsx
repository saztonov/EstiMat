import { useState, useMemo } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router';
import { Layout, Menu, Button, Typography, Dropdown, Drawer } from 'antd';
import {
  FileTextOutlined,
  AppstoreOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuOutlined,
  TeamOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';
import type { MenuProps } from 'antd';

const { Content } = Layout;
const { Text } = Typography;

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [open, setOpen] = useState(false);

  const menuItems = useMemo(() => {
    // Подрядчик видит только свои разделы; остальные роли — полное меню.
    if (user?.role === 'contractor') {
      return [
        { key: '/contractors', icon: <TeamOutlined />, label: 'Подрядчики' },
        { key: '/execution', icon: <CheckSquareOutlined />, label: 'Выполнение' },
      ];
    }
    const items = [
      { key: '/estimates', icon: <FileTextOutlined />, label: 'Сметы' },
      { key: '/references', icon: <AppstoreOutlined />, label: 'Справочники' },
      { key: '/contractors', icon: <TeamOutlined />, label: 'Подрядчики' },
      { key: '/execution', icon: <CheckSquareOutlined />, label: 'Выполнение' },
    ];
    if (user?.role === 'admin') {
      items.push({ key: '/administration', icon: <SettingOutlined />, label: 'Администрирование' });
    }
    return items;
  }, [user?.role]);

  const selectedKeys = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith('/references')) return ['/references'];
    if (path.startsWith('/administration')) return ['/administration'];
    if (path.startsWith('/contractors')) return ['/contractors'];
    if (path.startsWith('/execution')) return ['/execution'];
    if (path.startsWith('/estimates') || path.startsWith('/projects')) return ['/estimates'];
    return [path];
  }, [location.pathname]);

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key);
    setOpen(false);
  };

  // Рабочее пространство сметы (/estimates/:id) — узкие горизонтальные поля; список /estimates не затрагивается.
  const isEstimateWorkspace = /^\/estimates\/.+/.test(location.pathname);

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
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Плавающая кнопка-гамбургер; при открытом Drawer её перекрывает маска (zIndex Drawer ~1000). */}
      <Button
        type="text"
        icon={<MenuOutlined style={{ fontSize: 18 }} />}
        onClick={() => setOpen(true)}
        aria-label="Открыть меню"
        aria-expanded={open}
        style={{ position: 'fixed', top: 8, left: 8, zIndex: 900 }}
      />

      <Drawer
        placement="left"
        open={open}
        onClose={() => setOpen(false)}
        width={240}
        title={
          <Link to="/" onClick={() => setOpen(false)} style={{ fontSize: 20, fontWeight: 'bold' }}>
            EstiMat
          </Link>
        }
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      >
        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          items={menuItems}
          onClick={onMenuClick}
          style={{ flex: 1, borderRight: 0 }}
        />
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '8px 16px' }}>
          <Dropdown menu={{ items: userMenuItems }} placement="topLeft" trigger={['click']}>
            <Button
              type="text"
              icon={<UserOutlined />}
              style={{
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 8,
              }}
            >
              <Text ellipsis>{user?.fullName || user?.email}</Text>
            </Button>
          </Dropdown>
        </div>
      </Drawer>

      <Content
        style={{
          margin: isEstimateWorkspace ? '48px 8px 24px' : '48px 24px 24px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Outlet />
      </Content>
    </Layout>
  );
}
