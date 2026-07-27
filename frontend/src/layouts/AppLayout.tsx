import { Outlet } from 'react-router-dom';
import { MobileNavigation, SidebarNavigation } from '../components/Navigation';

export function AppLayout() {
  return <div className="app-shell"><SidebarNavigation /><main className="main-content"><Outlet /></main><MobileNavigation /></div>;
}
