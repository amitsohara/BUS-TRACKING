import React, { useState, useEffect } from 'react';
import { api, UserSession } from '../services/api.ts';
import { Shield, Bus, Key, Building2, User, ArrowRight, Lock, Sparkles, AlertTriangle } from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: (session: UserSession) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'LOGIN' | 'ONBOARD' | 'ACCEPT_INVITE'>('LOGIN');

  // Environment state
  const [demoModeEnabled, setDemoModeEnabled] = useState(false);
  const [isProduction, setIsProduction] = useState(false);

  // Login form - Default to clean empty inputs to avoid exposing demo credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invitation acceptance state
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<any>(null);
  const [inviteFullName, setInviteFullName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteConfirmPassword, setInviteConfirmPassword] = useState('');

  useEffect(() => {
    // Check for invitation token in URL query
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || params.get('invitation_token');
    if (token) {
      setInviteToken(token);
      api.getInvitationInfo(token)
        .then((res) => {
          if (res.success && res.invitation) {
            setInviteInfo(res.invitation);
            setInviteFullName(res.invitation.fullName || '');
            setMode('ACCEPT_INVITE');
          }
        })
        .catch((err) => {
          setError(err.message || 'Invitation is invalid or has expired');
        });
    }

    api.getAuthConfig().then((cfg) => {
      setDemoModeEnabled(!!cfg.demoModeEnabled);
      setIsProduction(!!cfg.isProduction);
      // In dev with demo mode enabled, optionally prefill DPS admin for frictionless local evaluation
      if (cfg.demoModeEnabled && !token) {
        setEmail('admin@dpsrkp.net');
        setPassword('Admin@12345');
      }
    }).catch(() => {
      // Default to strict production behavior on error
      setDemoModeEnabled(false);
      setIsProduction(true);
    });
  }, []);

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteToken) return;
    if (invitePassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (invitePassword !== inviteConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.acceptInvitation({
        token: inviteToken,
        password: invitePassword,
        fullName: inviteFullName,
        phone: invitePhone,
      });
      api.setSession(res);
      // Clean query string
      window.history.replaceState({}, document.title, window.location.pathname);
      onLoginSuccess(res);
    } catch (err: any) {
      setError(err.message || 'Failed to activate account');
    } finally {
      setLoading(false);
    }
  };

  // Onboard form
  const [schoolName, setSchoolName] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [city, setCity] = useState('New Delhi');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPhone, setAdminPhone] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(email, password);
      api.setSession(res);
      onLoginSuccess(res);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(demoEmail, demoPass);
      api.setSession(res);
      onLoginSuccess(res);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const fillDemoSchoolData = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setSchoolName(`Kendriya Vidyalaya Sec-${randomSuffix}`);
    setSchoolCode(`KV${randomSuffix}`);
    setCity('Bengaluru');
    setAdminFullName('Dr. Rajesh Menon');
    setAdminEmail(`rajesh.admin${randomSuffix}@kvs.edu.in`);
    setAdminPassword('AdminPass@2026');
    setAdminPhone('+91 98223 44556');
    setError(null);
  };

  const handleOnboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolName.trim() || !schoolCode.trim() || !adminFullName.trim() || !adminEmail.trim() || !adminPassword.trim()) {
      setError('Please fill in all required fields: School Name, School Code, Administrator Full Name, Email, and Password.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.registerSchool({
        schoolName: schoolName.trim(),
        schoolCode: schoolCode.trim().toUpperCase(),
        city: city.trim() || 'New Delhi',
        adminFullName: adminFullName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword: adminPassword.trim(),
        adminPhone: adminPhone.trim() || '+91 98000 00000',
      });
      api.setSession(res);
      onLoginSuccess(res);
    } catch (err: any) {
      setError(err.message || 'School onboarding failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Decorative Background Lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-indigo-500/10 blur-3xl pointer-events-none"></div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center items-center space-x-3 mb-2">
          <div className="w-12 h-12 bg-linear-to-tr from-amber-500 to-amber-400 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Bus className="w-7 h-7 text-slate-950" />
          </div>
          <div>
            <span className="text-2xl font-black text-white tracking-tight">Suraksha<span className="text-amber-400">Vahan</span></span>
            <span className="block text-[10px] text-indigo-300 font-bold uppercase tracking-widest">
              Multi-School Transit SaaS
            </span>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mb-6">
          Real-time GPS ingestion, QR boarding, parent portal, and school fleet safety
        </p>

        {/* Tab switcher */}
        {mode !== 'ACCEPT_INVITE' ? (
          <div className="flex bg-slate-800/80 p-1 rounded-xl mb-4 border border-slate-700/60">
            <button
              onClick={() => { setMode('LOGIN'); setError(null); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                mode === 'LOGIN' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('ONBOARD'); setError(null); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                mode === 'ONBOARD' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Register School Tenant
            </button>
          </div>
        ) : (
          <div className="bg-indigo-950/60 border border-indigo-500/40 p-3 rounded-xl mb-4 text-xs text-indigo-200 flex items-center justify-between">
            <div>
              <span className="font-bold text-white block">School Administrator Activation</span>
              <span>Invited to manage {inviteInfo?.schoolName || 'School'}</span>
            </div>
            <button
              onClick={() => { setMode('LOGIN'); setError(null); }}
              className="text-[11px] text-indigo-300 hover:text-white font-semibold cursor-pointer underline"
            >
              Standard Sign In
            </button>
          </div>
        )}

        <div className="bg-slate-800/90 backdrop-blur-md py-8 px-6 shadow-2xl rounded-2xl border border-slate-700/80 sm:px-10">
          {error && (
            <div className="mb-4 p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs font-medium">
              {error}
            </div>
          )}

          {mode === 'ACCEPT_INVITE' ? (
            <form onSubmit={handleAcceptInvite} className="space-y-4">
              <div className="p-3 bg-slate-900/90 border border-slate-700 rounded-xl space-y-1">
                <div className="text-[11px] text-slate-400">School Workspace</div>
                <div className="text-xs font-bold text-white">{inviteInfo?.schoolName} ({inviteInfo?.schoolCode})</div>
                <div className="text-[11px] text-indigo-300">Role: {inviteInfo?.role}</div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Invited Email</label>
                <input
                  type="email"
                  disabled
                  value={inviteInfo?.email || ''}
                  className="w-full px-3.5 py-2.5 bg-slate-900/50 border border-slate-700/60 rounded-xl text-xs text-slate-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Administrator Full Name *</label>
                <input
                  type="text"
                  required
                  value={inviteFullName}
                  onChange={(e) => setInviteFullName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Contact Phone</label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Set Password * (min 8 chars)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Confirm Password *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={inviteConfirmPassword}
                  onChange={(e) => setInviteConfirmPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-indigo-600/30 cursor-pointer disabled:opacity-60"
              >
                {loading ? 'Activating Account...' : 'Activate Account & Access Workspace'}
              </button>
            </form>
          ) : mode === 'LOGIN' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-indigo-600/30 cursor-pointer flex items-center justify-center space-x-2"
              >
                <span>{loading ? 'Authenticating...' : 'Sign In to Workspace'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleOnboard} className="space-y-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[11px] font-bold text-slate-300">New School Tenant Details</span>
                <button
                  type="button"
                  onClick={fillDemoSchoolData}
                  className="text-[10px] text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded-md border border-amber-500/30 transition cursor-pointer font-medium"
                >
                  ✨ Auto-Fill Sample Data
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">School Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Modern Public School, Noida"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">School Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="MPS-NOI"
                    value={schoolCode}
                    onChange={(e) => setSchoolCode(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white uppercase font-mono focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">City *</label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-700">
                <span className="text-[11px] font-bold text-indigo-400 block mb-2 uppercase tracking-wider">
                  Primary Administrator Account
                </span>
                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-0.5">Admin Full Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Dr. Rajesh Menon"
                      value={adminFullName}
                      onChange={(e) => setAdminFullName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-0.5">Admin Email *</label>
                    <input
                      type="email"
                      required
                      placeholder="admin@school.edu.in"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-0.5">Password *</label>
                      <input
                        type="password"
                        required
                        placeholder="Secure Password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-0.5">Mobile (Optional)</label>
                      <input
                        type="tel"
                        placeholder="+91 98765 43210"
                        value={adminPhone}
                        onChange={(e) => setAdminPhone(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-emerald-600/30 cursor-pointer disabled:opacity-60"
              >
                {loading ? 'Registering School...' : 'Launch School Workspace'}
              </button>
            </form>
          )}

          {/* Demo personas: Strictly hidden in production and only shown when SEED_SAMPLE_DATA=true in non-production */}
          {demoModeEnabled ? (
            <div className="mt-6 pt-5 border-t border-slate-700/80">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center space-x-1">
                  <Sparkles className="w-3 h-3 mr-1" />
                  Development Test Personas
                </span>
                <span className="text-[9px] bg-amber-500/10 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/20 font-mono">
                  SEED_SAMPLE_DATA=true
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleQuickDemoLogin('admin@dpsrkp.net', 'Admin@12345')}
                  className="p-2 rounded-lg bg-slate-900/80 hover:bg-indigo-950 text-slate-300 hover:text-white border border-slate-700/60 text-left transition cursor-pointer"
                >
                  <div className="font-bold text-[11px] text-amber-400">DPS School Admin</div>
                  <div className="text-[10px] text-slate-500 truncate">admin@dpsrkp.net</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickDemoLogin('driver.ramesh@dpsrkp.net', 'Driver@12345')}
                  className="p-2 rounded-lg bg-slate-900/80 hover:bg-indigo-950 text-slate-300 hover:text-white border border-slate-700/60 text-left transition cursor-pointer"
                >
                  <div className="font-bold text-[11px] text-emerald-400">Bus Driver Console</div>
                  <div className="text-[10px] text-slate-500 truncate">driver.ramesh@dpsrkp.net</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickDemoLogin('parent.sharma@gmail.com', 'Parent@12345')}
                  className="p-2 rounded-lg bg-slate-900/80 hover:bg-indigo-950 text-slate-300 hover:text-white border border-slate-700/60 text-left transition cursor-pointer"
                >
                  <div className="font-bold text-[11px] text-sky-400">Parent Portal (Aarav)</div>
                  <div className="text-[10px] text-slate-500 truncate">parent.sharma@gmail.com</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickDemoLogin('admin@ryanvasantkunj.edu.in', 'Admin@12345')}
                  className="p-2 rounded-lg bg-slate-900/80 hover:bg-indigo-950 text-slate-300 hover:text-white border border-slate-700/60 text-left transition cursor-pointer"
                >
                  <div className="font-bold text-[11px] text-rose-400">Ryan Intl Admin</div>
                  <div className="text-[10px] text-slate-500 truncate">Tenant Isolation Test</div>
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 pt-4 border-t border-slate-700/60 text-center">
              <span className="text-[10px] text-slate-500 flex items-center justify-center space-x-1">
                <Shield className="w-3 h-3 text-emerald-400 mr-1 inline" />
                Production Tenant Isolation Active • End-to-End Encrypted Transit
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
