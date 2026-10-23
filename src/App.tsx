import React, { useState, useEffect } from 'react';
import { api, UserSession } from './client/services/api.ts';
import { realtime } from './client/services/ws.ts';
import { Navbar } from './client/components/Navbar.tsx';
import { Sidebar } from './client/components/Sidebar.tsx';
import { OpenApiViewerModal } from './client/components/OpenApiViewerModal.tsx';

// Views
import { LoginView } from './client/views/LoginView.tsx';
import { DashboardView } from './client/views/DashboardView.tsx';
import { DriverConsoleView } from './client/views/DriverConsoleView.tsx';
import { ParentPortalView } from './client/views/ParentPortalView.tsx';
import { TripsMonitorView } from './client/views/TripsMonitorView.tsx';
import { StudentsManagementView } from './client/views/StudentsManagementView.tsx';
import { VehiclesManagementView } from './client/views/VehiclesManagementView.tsx';
import { DriversManagementView } from './client/views/DriversManagementView.tsx';
import { RoutesManagementView } from './client/views/RoutesManagementView.tsx';
import { AttendanceView } from './client/views/AttendanceView.tsx';
import { ReportsView } from './client/views/ReportsView.tsx';
import { AuditLogsView } from './client/views/AuditLogsView.tsx';
import { SettingsView } from './client/views/SettingsView.tsx';
import { SchoolsManagementView } from './client/views/SchoolsManagementView.tsx';

export default function App() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<string>('DASHBOARD');
  const [openApiModalOpen, setOpenApiModalOpen] = useState(false);

  useEffect(() => {
    checkActiveSession();

    const handleSessionExpired = () => {
      api.clearSession();
      realtime.disconnect();
      setSession(null);
    };

    window.addEventListener('sv_session_expired', handleSessionExpired);
    return () => {
      window.removeEventListener('sv_session_expired', handleSessionExpired);
    };
  }, []);

  const checkActiveSession = async () => {
    const token = api.getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await api.getMe();
      if (res.success) {
        const userSession: UserSession = {
          token,
          user: res.user,
          activeSchool: res.activeSchool,
          memberships: res.memberships || [],
        };
        api.setSession(userSession);
        setSession(userSession);
        realtime.connect(token);

        // If user is driver, route directly to driver console; if parent, to parent portal
        if (res.activeSchool?.role === 'DRIVER') {
          setCurrentView('DRIVER_CONSOLE');
        } else if (res.activeSchool?.role === 'PARENT') {
          setCurrentView('PARENT_PORTAL');
        }
      } else {
        api.clearSession();
      }
    } catch (err) {
      api.clearSession();
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSuccess = (newSession: UserSession) => {
    api.setSession(newSession);
    setSession(newSession);
    realtime.connect(newSession.token);
    if (newSession.activeSchool?.role === 'DRIVER') {
      setCurrentView('DRIVER_CONSOLE');
    } else if (newSession.activeSchool?.role === 'PARENT') {
      setCurrentView('PARENT_PORTAL');
    } else {
      setCurrentView('DASHBOARD');
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (e) {
      // ignore
    }
    api.clearSession();
    realtime.disconnect();
    setSession(null);
    setCurrentView('DASHBOARD');
  };

  const handleSwitchSchool = async (schoolId: string) => {
    try {
      const res = await api.switchContext(schoolId);
      if (res.success && session) {
        const updated: UserSession = {
          ...session,
          token: res.token,
          activeSchool: res.activeSchool,
        };
        api.setSession(updated);
        setSession(updated);
        window.location.reload();
      }
    } catch (err) {
      alert('Failed to switch school context');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <div className="w-10 h-10 border-3 border-amber-400 border-t-transparent rounded-full animate-spin mb-4"></div>
        <span className="text-sm font-semibold text-slate-300">Initializing SurakshaVahan Transit Platform...</span>
      </div>
    );
  }

  if (!session) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-100/70 flex flex-col font-sans text-slate-800">
      {/* Navbar */}
      <Navbar
        session={session}
        onLogout={handleLogout}
        onOpenOpenApi={() => setOpenApiModalOpen(true)}
        onOpenHealth={() => setCurrentView('SETTINGS')}
        onSwitchSchool={handleSwitchSchool}
      />

      {/* Main Workspace */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        <Sidebar
          currentView={currentView}
          onNavigate={(v) => setCurrentView(v)}
          userRole={session.activeSchool?.role}
          systemRole={session.user.systemRole}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 overflow-y-auto">
          {currentView === 'DASHBOARD' && <DashboardView onNavigate={(v) => setCurrentView(v)} />}
          {currentView === 'SCHOOLS' && <SchoolsManagementView onSwitchSchool={handleSwitchSchool} />}
          {currentView === 'DRIVER_CONSOLE' && <DriverConsoleView />}
          {currentView === 'PARENT_PORTAL' && <ParentPortalView />}
          {currentView === 'TRIPS' && <TripsMonitorView onNavigateToConsole={() => setCurrentView('DRIVER_CONSOLE')} />}
          {currentView === 'STUDENTS' && <StudentsManagementView />}
          {currentView === 'VEHICLES' && <VehiclesManagementView />}
          {currentView === 'DRIVERS' && <DriversManagementView />}
          {currentView === 'ROUTES' && <RoutesManagementView />}
          {currentView === 'ATTENDANCE' && <AttendanceView />}
          {currentView === 'REPORTS' && <ReportsView />}
          {currentView === 'AUDIT_LOGS' && <AuditLogsView />}
          {currentView === 'SETTINGS' && <SettingsView />}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden bg-white border-t border-slate-200 fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around py-2 px-1 text-[10px] font-semibold text-slate-600">
        <button
          onClick={() => setCurrentView('DASHBOARD')}
          className={`p-1.5 flex flex-col items-center ${currentView === 'DASHBOARD' ? 'text-indigo-600 font-bold' : ''}`}
        >
          <span>Dashboard</span>
        </button>
        <button
          onClick={() => setCurrentView('DRIVER_CONSOLE')}
          className={`p-1.5 flex flex-col items-center ${currentView === 'DRIVER_CONSOLE' ? 'text-indigo-600 font-bold' : ''}`}
        >
          <span>Driver Console</span>
        </button>
        <button
          onClick={() => setCurrentView('PARENT_PORTAL')}
          className={`p-1.5 flex flex-col items-center ${currentView === 'PARENT_PORTAL' ? 'text-indigo-600 font-bold' : ''}`}
        >
          <span>Parent Portal</span>
        </button>
        <button
          onClick={() => setCurrentView('TRIPS')}
          className={`p-1.5 flex flex-col items-center ${currentView === 'TRIPS' ? 'text-indigo-600 font-bold' : ''}`}
        >
          <span>Trips</span>
        </button>
        <button
          onClick={() => setCurrentView('STUDENTS')}
          className={`p-1.5 flex flex-col items-center ${currentView === 'STUDENTS' ? 'text-indigo-600 font-bold' : ''}`}
        >
          <span>Students</span>
        </button>
      </nav>

      {/* OpenAPI Spec & Flutter Architecture Modal */}
      {openApiModalOpen && <OpenApiViewerModal onClose={() => setOpenApiModalOpen(false)} />}
    </div>
  );
}
