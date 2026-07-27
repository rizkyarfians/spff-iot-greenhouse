import { UserRound } from 'lucide-react';

export function DashboardHeader() {
  return <header className="dashboard-header"><div><p className="eyebrow">Greenhouse Monitoring</p><h1>Dashboard</h1></div><div className="admin"><span>Hi, Admin!</span><div className="avatar"><UserRound /></div></div></header>;
}
