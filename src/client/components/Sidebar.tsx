import React from 'react';
import {
  LayoutDashboard,
  Building2,
  Radio,
  HeartHandshake,
  Bus,
  Users,
  Route,
  UserCheck,
  CheckCircle2,
  FileSpreadsheet,
  ShieldCheck,
  Settings,
} from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  userRole?: string;
  systemRole?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate, userRole, systemRole }) => {
  const isPlatformAdmin = systemRole === 'PLATFORM_ADMIN';

  const navItems = [
    { id: 'DASHBOARD', label: 'Dashboard', icon: LayoutDashboard },
    ...(isPlatformAdmin
      ? [{ id: 'SCHOOLS', label: 'School Management', icon: Building2, adminOnly: true }]
      : []),
    { id: 'DRIVER_CONSOLE', label: 'Driver GPS & Scan', icon: Radio, highlight: true },
    { id: 'PARENT_PORTAL', label: 'Parent Safety Portal', icon: HeartHandshake, highlight: true },
    { id: 'TRIPS', label: 'Trips & Dispatch', icon: Bus },
    { id: 'STUDENTS', label: 'Students & QR Passes', icon: Users },
    { id: 'VEHICLES', label: 'Fleet Vehicles', icon: Bus },
    { id: 'DRIVERS', label: 'Drivers & Staff', icon: UserCheck },
    { id: 'ROUTES', label: 'Routes & Stops', icon: Route },
    { id: 'ATTENDANCE', label: 'Attendance History', icon: CheckCircle2 },
    { id: 'REPORTS', label: 'Reports & CSV Export', icon: FileSpreadsheet },
    { id: 'AUDIT_LOGS', label: 'DPDP Audit Trail', icon: ShieldCheck },
    { id: 'SETTINGS', label: 'Tenant Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-200 shrink-0 hidden md:block min-h-[calc(100vh-4rem)] p-4">
      <div className="space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-xs shadow-indigo-600/30'
                  : item.highlight
                  ? 'text-indigo-900 bg-indigo-50/70 hover:bg-indigo-100/80 font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : item.highlight ? 'text-indigo-600' : 'text-slate-400'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* DPDP Act Badge in sidebar footer */}
      <div className="mt-8 p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] text-slate-500">
        <span className="font-bold text-slate-700 block mb-1">India Transport Safe</span>
        Protected under DPDP Act 2023 with opaque QR hashes and append-only attendance.
      </div>
    </aside>
  );
};
