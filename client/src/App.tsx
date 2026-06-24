import { Routes, Route, Navigate } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/shared/ProtectedRoute';
import { RoleRoute } from './components/shared/RoleRoute';
import { AppUpdateBanner } from './components/shared/AppUpdateBanner';
import { useAuthStore } from './store/authStore';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage';
import { EstimatesPage } from './pages/estimates/EstimatesPage';
import { EstimateDetailPage } from './pages/estimates/EstimateDetailPage';
import { EstimateMaterialsPage } from './pages/estimates/EstimateMaterialsPage';
import { ReferencesPage } from './pages/references/ReferencesPage';
import { AdministrationPage } from './pages/administration/AdministrationPage';
import { ContractorsPage } from './pages/contractors/ContractorsPage';
import { ExecutionPage } from './pages/execution/ExecutionPage';

// Стартовая страница зависит от роли: подрядчик — в свой раздел, остальные — в справочники.
function HomeRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  return <Navigate to={role === 'contractor' ? '/contractors' : '/references'} replace />;
}

export default function App() {
  return (
    <>
      <AppUpdateBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<HomeRedirect />} />
            {/* Разделы смет/справочников — закрыты для роли contractor */}
            <Route element={<RoleRoute allow={['admin', 'engineer', 'manager']} redirect="/contractors" />}>
              <Route path="/references" element={<ReferencesPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/estimates" element={<EstimatesPage />} />
              <Route path="/estimates/:id" element={<EstimateDetailPage />} />
              <Route path="/estimates/:id/materials" element={<EstimateMaterialsPage />} />
              <Route path="/administration" element={<AdministrationPage />} />
            </Route>
            {/* Доступно всем ролям */}
            <Route path="/contractors" element={<ContractorsPage />} />
            <Route path="/contractors/:estimateId" element={<ContractorsPage />} />
            <Route path="/execution" element={<ExecutionPage />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}
