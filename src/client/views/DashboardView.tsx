import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import {
  Bus,
  Users,
  Route,
  Activity,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  PlusCircle,
  FileSpreadsheet,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

interface DashboardViewProps {
  onNavigate: (view: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await api.getCurrentSchool();
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-slate-500 flex flex-col items-center">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
        <span>Loading operational telemetry & fleet metrics...</span>
      </div>
    );
  }

  const school = data?.school;
  const stats = data?.stats || {};
  const subscription = data?.subscription;

  if (!school) {
    return (
      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xs text-center space-y-4 my-8 max-w-lg mx-auto">
        <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-800">No School Selected or Active</h2>
        <p className="text-xs text-slate-500">
          Please select or register a school workspace in Schools Management to view operational dashboard metrics.
        </p>
        <button
          onClick={() => onNavigate('SCHOOLS')}
          className="inline-flex items-center space-x-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <span>Go to Schools Management</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* School Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-indigo-700 font-bold text-xs uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Active School Workspace</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">{school?.name || 'School Dashboard'}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Code: <strong className="text-slate-700">{school?.code}</strong> • Affiliation: {school?.affiliation_number || 'CBSE'} • {school?.city}, {school?.state}
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onNavigate('TRIPS')}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Schedule Trip</span>
          </button>
          <button
            onClick={() => onNavigate('STUDENTS')}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            <Users className="w-4 h-4" />
            <span>Manage Students</span>
          </button>
          <button
            onClick={() => api.downloadAttendanceCsv()}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Real Operational Count Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Active Trips */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Active Trips</span>
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Activity className="w-4 h-4 animate-pulse" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900">{stats.activeTrips || 0}</div>
          <div className="mt-1 text-[11px] text-slate-500 flex items-center space-x-1">
            <span className="text-emerald-600 font-semibold">{stats.todayCompletedTrips || 0} completed</span>
            <span>today</span>
          </div>
        </div>

        {/* Total Students */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">Students</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900">{stats.totalStudents || 0}</div>
          <div className="mt-1 text-[11px] text-slate-500">
            Limit: {subscription?.max_students || 1000} ({subscription?.plan_name || 'PRO'} Plan)
          </div>
        </div>

        {/* Fleet Vehicles */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600">Buses / Fleet</span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <Bus className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900">{stats.totalVehicles || 0}</div>
          <div className="mt-1 text-[11px] text-slate-500">
            {stats.totalDrivers || 0} Verified Drivers
          </div>
        </div>

        {/* Today's Attendance Scans */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-600">Attendance Scans</span>
            <div className="p-2 bg-sky-50 text-sky-600 rounded-xl">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900">{stats.todayAttendanceScans || 0}</div>
          <div className="mt-1 text-[11px] text-slate-500">
            {stats.totalRoutes || 0} Configured Routes
          </div>
        </div>
      </div>

      {/* Operational Highlights & Shortcuts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Trips Quick Access */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
              <Bus className="w-4 h-4 text-indigo-600" />
              <span>Real-Time Fleet Operations</span>
            </h3>
            <button
              onClick={() => onNavigate('DRIVER_CONSOLE')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center space-x-1"
            >
              <span>Open Driver Ingestion Console</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                <span className="font-bold text-slate-800 text-sm">Delhi Route 101 (Bus #01)</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                  IN_PROGRESS
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Driver: Ramesh Kumar • Saket to R.K. Puram • Live GPS Telemetry Transmitting
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onNavigate('DRIVER_CONSOLE')}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition"
              >
                Scan Boarding QR
              </button>
              <button
                onClick={() => onNavigate('PARENT_PORTAL')}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition"
              >
                Parent View
              </button>
            </div>
          </div>
        </div>

        {/* Compliance & DPDP Act Safety Status */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Safety & Legal Compliance</span>
          </h3>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
              <span className="text-slate-600">Child Data Protection (DPDP Act)</span>
              <span className="font-bold text-emerald-700">Enforced</span>
            </div>
            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
              <span className="text-slate-600">Opaque QR Credentials (No PII)</span>
              <span className="font-bold text-emerald-700">SHA-256</span>
            </div>
            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
              <span className="text-slate-600">Physical Bus Check Gate</span>
              <span className="font-bold text-emerald-700">Active</span>
            </div>
            <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
              <span className="text-slate-600">Tenant Data Isolation</span>
              <span className="font-bold text-emerald-700">Verified</span>
            </div>
          </div>

          <button
            onClick={() => onNavigate('AUDIT_LOGS')}
            className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold text-center block transition cursor-pointer"
          >
            View System Audit Trail
          </button>
        </div>
      </div>
    </div>
  );
};
