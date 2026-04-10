import { Outlet, useNavigate, useLocation, Link } from 'react-router';
import { Layout, Menu, Button, Typography, Dropdown } from 'antd';
import {
  ProjectOutlined,
  FileTextOutlined,
  BankOutlined,
  AppstoreOutlined,
  DollarOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';
import type { MenuProps } from 'antd';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/projects', icon: <ProjectOutlined />, label: 'Проекты' },
  { key: '/estimates', icon: <FileTextOutlined />, label: 'Сметы' },
  {
    key: 'admin',
    icon: <AppstoreOutlined />,
    label: 'Справочники',
    children: [
      { key: '/admin/organizations', icon: <BankOutlined />, label: 'Организации' },
      { key: '/admin/materials', icon: <AppstoreOutlined />, label: 'Материалы' },
      { key: '/admin/rates', icon: <DollarOutlined />, label: 'Расценки' },
    ],
  },
];

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

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
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['admin']}
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
