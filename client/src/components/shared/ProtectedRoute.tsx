import { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router';
import { Spin } from 'antd';
import { useAuthStore } from '../../store/authStore';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';

export function ProtectedRoute() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const location = useLocation();

  useAuthRefresh();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const returnUrl = location.pathname + location.search;
    return <Navigate to={`/login?returnUrl=${encodeURIComponent(returnUrl)}`} replace />;
  }

  return <Outlet />;
}
