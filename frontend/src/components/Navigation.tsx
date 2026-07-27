import { BarChart3, Clock3, LayoutDashboard, Menu, SlidersHorizontal } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const items = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Analytics', to: '/analytics', icon: BarChart3 },
  { label: 'Kontrol', to: '/control', icon: SlidersHorizontal },
  { label: 'Jadwal', to: '/schedule', icon: Clock3 },
  { label: 'Menu', to: '/menu', icon: Menu },
];

export function SidebarNavigation() {
  return <nav className="sidebar" aria-label="Navigasi utama">{items.map(({ label, to, icon: Icon }) => <NavLink key={label} to={to} className={({ isActive }) => `nav-button ${isActive ? 'active' : ''}`} aria-label={label} data-tooltip={label}><Icon /></NavLink>)}</nav>;
}

export function MobileNavigation() {
  return <nav className="mobile-nav" aria-label="Navigasi utama seluler">{items.map(({ label, to, icon: Icon }) => <NavLink key={label} to={to} className={({ isActive }) => `mobile-nav-button ${isActive ? 'active' : ''}`} aria-label={label}><Icon /><span>{label}</span></NavLink>)}</nav>;
}
