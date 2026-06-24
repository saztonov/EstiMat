import { Navigate, Outlet } from 'react-router';
import type { Role } from '@estimat/shared';
import { useAuthStore } from '../../store/authStore';

// Гард по ролям: если роль пользователя не входит в allow — редирект на redirect.
// Защита данных — на сервере; это лишь навигационное ограничение (подрядчик не ходит в разделы смет).
export function RoleRoute({ allow, redirect }: { allow: Role[]; redirect: string }) {
  const role = useAuthStore((s) => s.user?.role);
  if (role && !allow.includes(role)) return <Navigate to={redirect} replace />;
  return <Outlet />;
}
