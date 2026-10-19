import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { FileSpreadsheet, Download, ShieldAlert, AlertTriangle, Gauge } from 'lucide-react';

export const ReportsView: React.FC = () => {
  const [speedAlerts, setSpeedAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadReportsData();
  }, []);

  const loadReportsData = async () => {
    setLoading(true);
    try {
      const res = await api.getSafetyExceptions();
      setSpeedAlerts(res.speedAlerts || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
            <span>Operational Reports & Compliance Exports</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Download certified CSV reports for school board auditing and transport safety compliance
          </p>
        </div>
      </div>

      {/* CSV Export Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center space-x-3 text-emerald-600 font-bold text-sm">
            <FileSpreadsheet className="w-5 h-5" />
            <span>Student Attendance Manifest CSV</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Detailed log of every student boarding and drop-off event, timestamp, stop checkpoint, bus registration,
            and verification method.
          </p>
          <button
            onClick={() => api.downloadAttendanceCsv()}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export Attendance CSV</span>
          </button>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center space-x-3 text-indigo-600 font-bold text-sm">
            <FileSpreadsheet className="w-5 h-5" />
            <span>Trip Fleet Performance CSV</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Summary of scheduled start times, actual start and completion times, driver attribution, and passenger reconciliation
            metrics.
          </p>
          <button
            onClick={() => api.downloadTripsCsv()}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export Trips Log CSV</span>
          </button>
        </div>
      </div>

      {/* Over-Speed Telemetry Alert Log */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center space-x-2">
          <Gauge className="w-4 h-4 text-rose-600" />
          <span>Vehicle Speed Exception Logs</span>
        </h3>

        {loading ? (
          <div className="py-12 text-center text-slate-400">Loading telemetry audit...</div>
        ) : speedAlerts.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            Zero speed limit violations detected. Fleet drivers are adhering to speed restrictions.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {speedAlerts.map((sa) => (
              <div key={sa.id} className="py-3 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-800">
                    {sa.bus_number} • Driver: {sa.driver_name}
                  </div>
                  <span className="text-[11px] text-slate-500">Route: {sa.route_name}</span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-rose-600 font-mono text-sm">
                    {Math.round(sa.speed_kmh)} km/h
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    Limit: {sa.speed_limit_kmh} km/h • {new Date(sa.recorded_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
