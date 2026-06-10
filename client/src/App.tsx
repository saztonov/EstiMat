import { Routes, Route, Navigate } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/shared/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage';
import { EstimatesPage } from './pages/estimates/EstimatesPage';
import { EstimateDetailPage } from './pages/estimates/EstimateDetailPage';
import { ReferencesPage } from './pages/references/ReferencesPage';
import { AdministrationPage } from './pages/administration/AdministrationPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/references" replace />} />
          <Route path="/references" element={<ReferencesPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/estimates" element={<EstimatesPage />} />
          <Route path="/estimates/:id" element={<EstimateDetailPage />} />
          <Route path="/administration" element={<AdministrationPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
