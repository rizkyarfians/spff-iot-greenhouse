import { useLocation } from 'react-router-dom';
import { DashboardHeader } from '../components/DashboardHeader';

export function PlaceholderPage() {
  const { pathname } = useLocation();
  const title = ({ '/analytics': 'Analytics', '/control': 'Kontrol', '/schedule': 'Jadwal', '/menu': 'Menu & Pengaturan' } as Record<string, string>)[pathname] ?? 'Dashboard';
  return <><DashboardHeader /><section className="card placeholder-page"><p className="eyebrow">IoT Greenhouse</p><h2>{title}</h2><p>Area ini siap dikembangkan lebih lanjut. Ringkasan dan kontrol utama tersedia di halaman Dashboard.</p></section></>;
}
