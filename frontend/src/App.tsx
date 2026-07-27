import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

export default function App() {
  return <Routes><Route element={<AppLayout />}><Route path="/" element={<DashboardPage />} /><Route path="/analytics" element={<PlaceholderPage />} /><Route path="/control" element={<PlaceholderPage />} /><Route path="/schedule" element={<PlaceholderPage />} /><Route path="/menu" element={<PlaceholderPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes>;
}
