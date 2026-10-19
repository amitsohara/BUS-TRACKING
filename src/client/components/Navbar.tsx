import React, { useState } from 'react';
import { UserSession, api } from '../services/api.ts';
import {
  Bus,
  Building2,
  LogOut,
  Code2,
  Activity,
  User,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';

interface NavbarProps {
  session: UserSession;
  onLogout: () => void;
  onOpenOpenApi: () => void;
  onOpenHealth: () => void;
  onSwitchSchool: (schoolId: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  session,
  onLogout,
  onOpenOpenApi,
  onOpenHealth,
  onSwitchSchool,
}) => {
  const [schoolDropdownOpen, setSchoolDropdownOpen] = useState(false);

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-linear-to-tr from-amber-500 to-amber-400 rounded-xl flex items-center justify-center shadow-md shadow-amber-500/20">
            <Bus className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <span className="font-extrabold text-slate-900 text-lg tracking-tight">
              Suraksha<span className="text-amber-500">Vahan</span>
            </span>
            <span className="hidden sm:inline-block ml-2 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-bold uppercase tracking-wider">
              Transit SaaS
            </span>
          </div>
        </div>

        {/* Tenant Switcher & Quick Tools */}
        <div className="flex items-center space-x-3">
          {/* Active School Dropdown */}
          {session.activeSchool && (
            <div className="relative">
              <button
                onClick={() => setSchoolDropdownOpen(!schoolDropdownOpen)}
                className="flex items-center space-x-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 transition cursor-pointer"
              >
                <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                <span className="max-w-[140px] sm:max-w-[200px] truncate">{session.activeSchool.schoolName}</span>
                <span className="text-[10px] text-slate-400 uppercase font-mono">({session.activeSchool.schoolCode})</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {schoolDropdownOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in zoom-in-95">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    Switch School Tenant
                  </div>
                  {session.memberships.map((m) => (
                    <button
                      key={m.school_id}
                      onClick={() => {
                        onSwitchSchool(m.school_id);
                        setSchoolDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 transition cursor-pointer ${
                        m.school_id === session.activeSchool?.schoolId ? 'font-bold text-indigo-600 bg-indigo-50/50' : 'text-slate-700'
                      }`}
                    >
                      <span className="truncate">{m.school_name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{m.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* OpenAPI Contract Button */}
          <button
            onClick={onOpenOpenApi}
            className="hidden sm:inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-semibold transition cursor-pointer"
            title="View OpenAPI 3.0 Contract and Flutter Mobile Architecture"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>API & Flutter Docs</span>
          </button>

          {/* User Profile & Role */}
          <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
            <div className="text-right hidden md:block">
              <span className="block text-xs font-bold text-slate-800 leading-tight">
                {session.user.fullName}
              </span>
              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-sm">
                {session.activeSchool?.role || session.user.systemRole}
              </span>
            </div>

            <button
              onClick={onLogout}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
