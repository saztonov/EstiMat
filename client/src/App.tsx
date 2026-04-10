import { Routes, Route, Navigate } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/shared/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage';
import { EstimatesPage } from './pages/estimates/EstimatesPage';
import { EstimateDetailPage } from './pages/estimates/EstimateDetailPage';
import { OrganizationsPage } from './pages/admin/OrganizationsPage';
import { MaterialsPage } from './pages/admin/MaterialsPage';
import { RatesPage } from './pages/admin/RatesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/estimates" element={<EstimatesPage />} />
          <Route path="/estimates/:id" element={<EstimateDetailPage />} />
          <Route path="/admin/organizations" element={<OrganizationsPage />} />
          <Route path="/admin/materials" element={<MaterialsPage />} />
          <Route path="/admin/rates" element={<RatesPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
