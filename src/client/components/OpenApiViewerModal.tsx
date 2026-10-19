import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { X, Code2, Smartphone, Download, CheckCircle2 } from 'lucide-react';

interface OpenApiViewerModalProps {
  onClose: () => void;
}

export const OpenApiViewerModal: React.FC<OpenApiViewerModalProps> = ({ onClose }) => {
  const [spec, setSpec] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'SPEC' | 'FLUTTER_PHASE2'>('FLUTTER_PHASE2');

  useEffect(() => {
    api.getOpenApiSpec().then(setSpec).catch(console.error);
  }, []);

  const handleDownload = () => {
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'surakshavahan-openapi-v1.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full h-[85vh] flex flex-col overflow-hidden border border-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">REST API & Mobile-Ready Contract</h3>
              <p className="text-xs text-slate-500">OpenAPI 3.0 Specification & Phase 2 Flutter Architecture</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleDownload}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download JSON</span>
            </button>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-200 bg-slate-100/50 px-6 pt-2">
          <button
            onClick={() => setActiveTab('FLUTTER_PHASE2')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === 'FLUTTER_PHASE2'
                ? 'border-indigo-600 text-indigo-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>Phase 2 Flutter Client Architecture</span>
          </button>
          <button
            onClick={() => setActiveTab('SPEC')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === 'SPEC'
                ? 'border-indigo-600 text-indigo-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>OpenAPI 3.0 JSON Schema</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 text-sm text-slate-700">
          {activeTab === 'FLUTTER_PHASE2' ? (
            <div className="space-y-6">
              <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                <h4 className="font-bold text-indigo-900 mb-1">Single Backend, Dual Native Clients</h4>
                <p className="text-xs text-indigo-700 leading-relaxed">
                  The Phase 1 Node.js/TypeScript backend was engineered so that neither the Flutter Driver App nor the
                  Flutter Parent App require duplicate business logic or a separate mobile gateway.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Driver App Contract */}
                <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                  <div className="flex items-center space-x-2 text-indigo-700 font-bold mb-3">
                    <Smartphone className="w-4 h-4" />
                    <span>Flutter Driver App Contract</span>
                  </div>
                  <ul className="space-y-2 text-xs text-slate-600">
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>Auth:</strong> <code>POST /api/v1/auth/login</code> returns scoped JWT token and assigned vehicle.</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>Trip Start/End:</strong> <code>POST /api/v1/trips/{'{id}'}/start</code> and <code>/complete</code> with physical check validation.</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>GPS Background Ingestion:</strong> <code>POST /api/v1/trips/{'{id}'}/locations</code> every 5-10s using <code>flutter_background_geolocation</code>.</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>QR Camera Boarding:</strong> <code>POST /api/v1/trips/{'{id}'}/attendance/scan</code> with mobile camera scanning using <code>mobile_scanner</code>.</span>
                    </li>
                  </ul>
                </div>

                {/* Parent App Contract */}
                <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                  <div className="flex items-center space-x-2 text-emerald-700 font-bold mb-3">
                    <Smartphone className="w-4 h-4" />
                    <span>Flutter Parent App Contract</span>
                  </div>
                  <ul className="space-y-2 text-xs text-slate-600">
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>Child Roster:</strong> <code>GET /api/v1/parents/children</code> strictly scoped to guardian account.</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>Live Stream:</strong> Connects to <code>/ws</code> and subscribes to child active trip for real-time bus motion without polling.</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>Instant Alerts:</strong> Boarding confirmed, drop-off confirmed, geofence arrival, and delay notifications.</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong>Digital Pass:</strong> Renders cryptographic QR badge for offline student boarding card.</span>
                    </li>
                  </ul>
                </div>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-2">Token Refresh & Reconnect Flow</h5>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Mobile clients cache JWT tokens securely in <code>FlutterSecureStorage</code> (iOS Keychain & Android EncryptedSharedPreferences).
                  Upon network dropouts, the WebSocket client reconnects automatically with exponential backoff and re-subscribes to active trip channels.
                </p>
              </div>
            </div>
          ) : (
            <pre className="p-4 bg-slate-900 text-slate-200 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
              {JSON.stringify(spec, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
