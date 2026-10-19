import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { UserCheck, Plus, Phone, Award, ShieldAlert } from 'lucide-react';

export const DriversManagementView: React.FC = () => {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Form State
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('2029-12-31');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [bloodGroup, setBloodGroup] = useState('B+');
  const [yearsExperience, setYearsExperience] = useState('8');
  const [email, setEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('Driver@12345');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadDrivers();
  }, []);

  const loadDrivers = async () => {
    setLoading(true);
    try {
      const res = await api.getDrivers();
      setDrivers(res.drivers || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createDriver({
        fullName,
        phone,
        licenseNumber,
        licenseExpiry,
        emergencyContact,
        bloodGroup,
        yearsExperience: parseInt(yearsExperience, 10),
        email,
        loginPassword,
      });
      alert('Driver registered successfully with mobile app login credentials.');
      setCreateModalOpen(false);
      setFullName('');
      setPhone('');
      setLicenseNumber('');
      loadDrivers();
    } catch (err: any) {
      alert(err.message || 'Failed to register driver');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <UserCheck className="w-5 h-5 text-indigo-600" />
            <span>Driver & Staff Roster</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Total {drivers.length} commercial drivers verified under Indian transport safety norms
          </p>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Driver</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-3 py-16 text-center text-slate-400">Loading driver records...</div>
        ) : drivers.length === 0 ? (
          <div className="col-span-3 py-16 text-center text-slate-400">No drivers enrolled yet.</div>
        ) : (
          drivers.map((d) => (
            <div key={d.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-sm">
                  {d.full_name.charAt(0)}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  d.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                }`}>
                  {d.status}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-800">{d.full_name}</h3>
                <p className="text-xs text-slate-500 font-mono flex items-center space-x-1 mt-0.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span>{d.phone}</span>
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Commercial License:</span>
                  <span className="font-mono font-semibold text-slate-800">{d.license_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">License Expiry:</span>
                  <span className="font-semibold text-slate-700">{d.license_expiry}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Experience:</span>
                  <span className="font-semibold text-slate-700">{d.years_experience} Years</span>
                </div>
              </div>

              <div className="text-[11px] text-slate-500 flex justify-between items-center pt-1 border-t border-slate-100">
                <span>Completed Trips: <strong>{d.total_completed_trips || 0}</strong></span>
                <span className="text-indigo-600 font-medium">{d.user_email || 'Console Enabled'}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Register Driver Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1">Register Driver & Issue Login</h3>
            <p className="text-xs text-slate-500 mb-4">
              Enrolls driver with commercial license details and provisions Driver App credentials
            </p>

            <form onSubmit={handleCreateDriver} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98765 00000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Driving License No *</label>
                  <input
                    type="text"
                    required
                    placeholder="DL-0420110023456"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">License Expiry *</label>
                  <input
                    type="date"
                    required
                    value={licenseExpiry}
                    onChange={(e) => setLicenseExpiry(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Years Experience</label>
                  <input
                    type="number"
                    min={0}
                    value={yearsExperience}
                    onChange={(e) => setYearsExperience(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <span className="text-xs font-bold text-slate-700 block mb-2">Driver App Login Account</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input
                      type="email"
                      placeholder="driver.login@school.net"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                    />
                  </div>
                  <div>
                    <input
                      type="password"
                      placeholder="Password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {submitting ? 'Registering...' : 'Enroll Driver'}
                </button>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
