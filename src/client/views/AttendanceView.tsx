import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { CheckCircle2, Download, ShieldAlert, Clock, AlertTriangle, QrCode, Filter } from 'lucide-react';

export const AttendanceView: React.FC = () => {
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [allEvents, setAllEvents] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'ALL' | 'MANUAL'>('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    loadAttendance();
  }, []);

  const loadAttendance = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSafetyExceptions();
      setExceptions(res.manualOverrides || []);
      setAllEvents(res.allEvents || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load attendance events');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCsv = () => {
    api.downloadAttendanceCsv(fromDate, toDate);
  };

  const displayedList = activeTab === 'ALL' ? allEvents : exceptions;

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>Attendance History & Verification</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable log of QR card scans, manual exceptions, and parent notifications
          </p>
        </div>

        <button
          onClick={handleDownloadCsv}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Export Official Attendance CSV</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span>{error}</span>
          </div>
          <button
            onClick={loadAttendance}
            className="px-2.5 py-1 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Date Filter & Tab Switcher Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setActiveTab('ALL')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'ALL' ? 'bg-white text-indigo-700 shadow-xs font-bold' : 'text-slate-600'
            }`}
          >
            All Events ({allEvents.length})
          </button>
          <button
            onClick={() => setActiveTab('MANUAL')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'MANUAL' ? 'bg-white text-amber-700 shadow-xs font-bold' : 'text-slate-600'
            }`}
          >
            Manual Overrides ({exceptions.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-2 text-xs text-slate-600">
            <span>From:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            />
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-600">
            <span>To:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            />
          </div>
          <button
            onClick={handleDownloadCsv}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
          >
            Filter & Export
          </button>
        </div>
      </div>

      {/* Attendance Events List */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center space-x-2">
          {activeTab === 'ALL' ? (
            <>
              <QrCode className="w-4 h-4 text-indigo-600" />
              <span>Verified Student Boarding & Drop-Off Feed</span>
            </>
          ) : (
            <>
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>Manual Fallback Overrides & Safety Exceptions</span>
            </>
          )}
        </h3>

        {loading ? (
          <div className="py-12 text-center text-slate-400">Loading attendance records...</div>
        ) : displayedList.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            {activeTab === 'ALL'
              ? 'No attendance events recorded yet today.'
              : 'No manual overrides recorded. All student transit scans verified through authentic QR cards.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {displayedList.map((item) => (
              <div key={item.id} className="py-3.5 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-800 text-xs">{item.student_name}</span>
                    <span className="text-[10px] font-mono text-slate-500">Adm: {item.admission_number}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        item.event_type === 'BOARDING'
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {item.event_type}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        item.scan_method === 'QR'
                          ? 'bg-slate-100 text-slate-700 font-mono'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {item.scan_method === 'QR' ? 'QR Pass' : 'Manual Override'}
                    </span>
                  </div>

                  {item.manual_reason && (
                    <p className="text-xs text-amber-800 bg-amber-50/60 px-2 py-1 rounded-md inline-block">
                      Override Reason: <strong>{item.manual_reason}</strong>
                    </p>
                  )}

                  <p className="text-[11px] text-slate-500">
                    Stop: <strong>{item.stop_name || 'Designated Stop'}</strong> • Route: {item.route_name || item.route_code || 'Route'} • Bus: {item.bus_number || 'Bus'}
                    {item.scanned_by_name || item.logged_by_name ? ` • Scanned By: ${item.scanned_by_name || item.logged_by_name}` : ''}
                  </p>
                </div>

                <div className="text-right text-xs text-slate-500 shrink-0">
                  <Clock className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
                  <span>{new Date(item.scanned_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
