import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
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
    // Пункты — настоящие ссылки (<a href>): средний/Ctrl-клик открывает раздел
    // в новой вкладке штатным поведением браузера. key = путь маршрута.
    const navItem = (key: string, icon: ReactNode, label: string) => ({
      key,
      label: (
        <Link to={key} className="estimat-nav-link">
          {icon}
          <span>{label}</span>
        </Link>
      ),
    });

    // Подрядчик видит только свои разделы; остальные роли — полное меню.
    // Для подрядчика раздел «Подрядчики» называется «Сметы».
    if (user?.role === 'contractor') {
      return [
        navItem('/contractors', <TeamOutlined />, 'Сметы'),
        navItem('/execution', <CheckSquareOutlined />, 'Выполнение'),
      ];
    }
    const items = [
      navItem('/estimates', <FileTextOutlined />, 'Сметы'),
      navItem('/contractors', <TeamOutlined />, 'Подрядчики'),
      navItem('/execution', <CheckSquareOutlined />, 'Выполнение'),
      navItem('/references', <AppstoreOutlined />, 'Справочники'),
    ];
    if (user?.role === 'admin') {
      items.push(navItem('/administration', <SettingOutlined />, 'Администрирование'));
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

  // Навигацию выполняет <Link> в пункте; обработчик лишь закрывает Drawer
  // (на средний клик событие click не возникает — Drawer останется открытым).
  const onMenuClick: MenuProps['onClick'] = () => setOpen(false);

  // Рабочее пространство сметы рендерится на /estimates/:id и /projects/:id (оба → EstimateEditor).
  // Точное сопоставление: список /estimates и /estimates/:id/materials НЕ затрагиваются.
  const isEstimateWorkspace =
    /^\/estimates\/[^/]+$/.test(location.pathname) || /^\/projects\/[^/]+$/.test(location.pathname);
  // Раздел «Подрядчики» (список и карточка объекта) — тот же компактный вид, что и у сметы.
  const isContractors = location.pathname.startsWith('/contractors');
  const isCompactLayout = isEstimateWorkspace || isContractors;

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'Личный кабинет',
      onClick: () => {
        navigate('/profile');
        setOpen(false);
      },
    },
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
          className="estimat-nav-menu"
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
        // Workspace и раздел «Подрядчики»: шапка поднята в верхнюю полосу (верх 0; гамбургер
        // обходится левым отступом шапки — тулбара сметы / шапки Card подрядчиков), компактные
        // боковые/нижний отступы. Прочие страницы — как было. Отступы — в index.css
        // (на узких экранах сужаются media query).
        className={isCompactLayout ? 'estimat-content--compact' : 'estimat-content'}
        style={{
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
