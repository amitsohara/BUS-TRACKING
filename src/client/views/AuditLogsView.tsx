import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { ShieldCheck, Search, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

export const AuditLogsView: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({ page: 1, limit: 30, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAuditLogs(1);
  }, []);

  const loadAuditLogs = async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.getAuditLogs({ page, limit: 30 });
      setLogs(res.logs || []);
      setPagination(res.pagination || {});
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
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <span>DPDP Act Audit Trail & Security Ledger</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable system activity logs recording trip starts, badge creations, scan outcomes, and admin mutations
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Timestamp</th>
                <th className="px-6 py-3.5">Action</th>
                <th className="px-6 py-3.5">Entity</th>
                <th className="px-6 py-3.5">Actor</th>
                <th className="px-6 py-3.5">Details (JSON Delta)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">Loading audit records...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">No audit logs recorded yet.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 font-bold text-indigo-700">
                      {log.action}
                    </td>
                    <td className="px-6 py-3 text-slate-700">
                      {log.entity_type} {log.entity_id ? `(#${log.entity_id})` : ''}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {log.user_name || log.user_email || 'System / Auto'}
                    </td>
                    <td className="px-6 py-3 text-slate-500 max-w-xs truncate" title={log.new_values || ''}>
                      {log.new_values || 'N/A'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} total logs)
            </span>
            <div className="flex space-x-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => loadAuditLogs(pagination.page - 1)}
                className="p-1 rounded border border-slate-300 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => loadAuditLogs(pagination.page + 1)}
                className="p-1 rounded border border-slate-300 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
