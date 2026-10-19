import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { Settings, Shield, Sliders, CreditCard, Save } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<any>({
    speedLimitKmh: 45,
    geofenceBufferMeters: 50,
    allowManualAttendance: true,
    strictReconciliationRequired: true,
    smsNotificationsEnabled: false,
    whatsappNotificationsEnabled: false,
  });
  const [subscription, setSubscription] = useState<any>(null);
  const [school, setSchool] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await api.getCurrentSchool();
      setSchool(res.school);
      setSubscription(res.subscription);
      if (res.settings) {
        setSettings({
          speedLimitKmh: res.settings.speed_limit_kmh ?? 45,
          geofenceBufferMeters: res.settings.geofence_buffer_meters ?? 50,
          allowManualAttendance: res.settings.allow_manual_attendance === 1,
          strictReconciliationRequired: res.settings.strict_reconciliation_required === 1,
          smsNotificationsEnabled: res.settings.sms_notifications_enabled === 1,
          whatsappNotificationsEnabled: res.settings.whatsapp_notifications_enabled === 1,
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSettings(settings);
      alert('Tenant settings updated successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            <span>School Tenant Settings & Policies</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure safety thresholds, geofencing, notification channels, and SaaS subscription limits
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Safety & Transit Thresholds */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-indigo-600" />
            <span>Safety Limits & Geofencing</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Fleet Speed Limit (km/h)
              </label>
              <input
                type="number"
                min={20}
                max={80}
                value={settings.speedLimitKmh}
                onChange={(e) => setSettings({ ...settings, speedLimitKmh: parseInt(e.target.value, 10) })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Trips exceeding this speed trigger instant safety audit warnings.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Default Stop Geofence Buffer (Meters)
              </label>
              <input
                type="number"
                min={20}
                max={200}
                value={settings.geofenceBufferMeters}
                onChange={(e) => setSettings({ ...settings, geofenceBufferMeters: parseInt(e.target.value, 10) })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Proximity radius to automatically detect bus arrival at scheduled stop.
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-3">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.strictReconciliationRequired}
                onChange={(e) => setSettings({ ...settings, strictReconciliationRequired: e.target.checked })}
                className="rounded text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="text-xs font-bold text-slate-800">Strict Physical & Attendance Reconciliation</span>
                <p className="text-[11px] text-slate-500">
                  Blocks ending a trip until the driver confirms empty bus check and accounts for any missing drop-off scans.
                </p>
              </div>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.allowManualAttendance}
                onChange={(e) => setSettings({ ...settings, allowManualAttendance: e.target.checked })}
                className="rounded text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="text-xs font-bold text-slate-800">Allow Manual Attendance Override</span>
                <p className="text-[11px] text-slate-500">
                  Permits driver/attendant to record boarding if student lost or damaged physical QR card (audited).
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Subscription Card */}
        {subscription && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
              <CreditCard className="w-4 h-4 text-emerald-600" />
              <span>SaaS Subscription & Tenant Quotas</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl">
                <span className="text-slate-400 block text-[10px]">Tier</span>
                <span className="font-bold text-slate-800 text-sm">{subscription.plan_name}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl">
                <span className="text-slate-400 block text-[10px]">Status</span>
                <span className="font-bold text-emerald-700 text-sm">{subscription.status}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl">
                <span className="text-slate-400 block text-[10px]">Vehicle Limit</span>
                <span className="font-bold text-slate-800 text-sm">{subscription.max_vehicles} Buses</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl">
                <span className="text-slate-400 block text-[10px]">Student Limit</span>
                <span className="font-bold text-slate-800 text-sm">{subscription.max_students} Students</span>
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center space-x-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
        </button>
      </form>
    </div>
  );
};
