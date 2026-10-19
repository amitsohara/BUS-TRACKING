import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { X, Printer, ShieldCheck, Download, AlertTriangle } from 'lucide-react';

interface StudentQrBadgeModalProps {
  studentId: string;
  onClose: () => void;
  onRevoked?: () => void;
}

export const StudentQrBadgeModal: React.FC<StudentQrBadgeModalProps> = ({
  studentId,
  onClose,
  onRevoked,
}) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    fetchBadge();
  }, [studentId]);

  const fetchBadge = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStudentQrBadge(studentId);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load QR badge');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!data?.qrDataUrl) return;
    const a = document.createElement('a');
    a.href = data.qrDataUrl;
    a.download = `bus-pass-${data.student.admission_number}.png`;
    a.click();
  };

  const handleRevoke = async () => {
    if (!window.confirm('Are you sure you want to revoke this QR credential? The physical badge will no longer be accepted by driver scanners.')) {
      return;
    }
    setRevoking(true);
    try {
      await api.revokeStudentQr(studentId, 'Reported lost/replaced badge');
      alert('QR badge revoked. Re-opening will issue a new secure credential.');
      onRevoked?.();
      fetchBadge();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke badge');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-slate-800">Student Transit Pass</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="py-12 text-center text-slate-500 flex flex-col items-center">
              <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
              <span>Generating cryptographic transit pass...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 text-rose-700 rounded-xl text-sm flex items-start space-x-2">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : data ? (
            <div className="flex flex-col items-center">
              {/* Printable ID Card Container */}
              <div
                id="printable-student-card"
                className="w-full bg-linear-to-b from-indigo-900 via-indigo-800 to-slate-900 text-white rounded-xl p-5 shadow-lg relative overflow-hidden border border-indigo-700"
              >
                {/* Decorative Pattern */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>

                {/* School Header */}
                <div className="text-center pb-3 border-b border-indigo-700/60 mb-4">
                  <div className="text-[11px] font-bold tracking-wider uppercase text-amber-400">
                    SURAKSHAVAHAN SECURE TRANSIT PASS
                  </div>
                  <div className="text-xs text-indigo-200">CBSE Affiliated School Transport</div>
                </div>

                {/* Student Bio */}
                <div className="flex items-center space-x-4 mb-4">
                  <div className="w-16 h-16 rounded-xl bg-indigo-700/80 border-2 border-indigo-400/30 flex items-center justify-center text-xl font-bold text-white shadow-inner">
                    {data.student.full_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-base font-bold truncate text-white">{data.student.full_name}</h4>
                    <p className="text-xs text-indigo-200">
                      Adm No: <strong className="text-white">{data.student.admission_number}</strong>
                    </p>
                    <p className="text-xs text-indigo-200">
                      Class: <span className="text-white">{data.student.grade} - {data.student.section}</span>
                    </p>
                    <p className="text-xs text-indigo-200">
                      Emergency: <span className="text-emerald-400 font-mono">{data.student.emergency_phone}</span>
                    </p>
                  </div>
                </div>

                {/* QR Code Container */}
                <div className="bg-white rounded-xl p-3 flex flex-col items-center shadow-md">
                  <img
                    src={data.qrDataUrl}
                    alt="Cryptographic Student QR Badge"
                    className="w-48 h-48 rounded-lg"
                  />
                  <div className="mt-2 text-center">
                    <span className="font-mono text-xs font-semibold text-slate-800 tracking-wider">
                      {data.credential.tokenHint}
                    </span>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Cryptographic Opaque Token • Zero PII Leakage
                    </p>
                  </div>
                </div>

                <div className="mt-3 text-center text-[10px] text-indigo-300">
                  Valid thru: {data.credential.expiresAt} • Scan at Bus Boarding & Drop-Off
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-5 w-full flex items-center justify-between gap-3">
                <button
                  onClick={handleDownload}
                  className="flex-1 inline-flex items-center justify-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Save QR</span>
                </button>
                <button
                  onClick={handlePrint}
                  className="flex-1 inline-flex items-center justify-center space-x-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-medium shadow-sm transition cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Pass</span>
                </button>
                <button
                  onClick={handleRevoke}
                  disabled={revoking}
                  className="inline-flex items-center justify-center px-3 py-2 border border-rose-200 hover:bg-rose-50 text-rose-600 rounded-xl text-xs font-medium transition cursor-pointer"
                  title="Revoke lost or damaged badge"
                >
                  Revoke
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
