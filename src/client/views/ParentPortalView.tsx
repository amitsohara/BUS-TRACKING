import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { realtime } from '../services/ws.ts';
import { MapViewer } from '../components/MapViewer.tsx';
import {
  Users,
  Bus,
  ShieldCheck,
  Bell,
  Clock,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Phone,
  RefreshCw,
} from 'lucide-react';

export const ParentPortalView: React.FC = () => {
  const [children, setChildren] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [verificationRequests, setVerificationRequests] = useState<any[]>([]);
  const [selectedChildIndex, setSelectedChildIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Verification Request Modal State
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [availableSchools, setAvailableSchools] = useState<any[]>([]);
  const [reqSchoolCode, setReqSchoolCode] = useState('');
  const [reqStudentAdmNo, setReqStudentAdmNo] = useState('');
  const [reqStudentName, setReqStudentName] = useState('');
  const [reqParentName, setReqParentName] = useState('');
  const [reqRelationship, setReqRelationship] = useState('FATHER');
  const [submittingReq, setSubmittingReq] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);

  useEffect(() => {
    loadParentData();
  }, []);

  const loadParentData = async () => {
    setLoading(true);
    try {
      const [kidsRes, notifsRes, reqsRes, schoolsRes] = await Promise.all([
        api.getParentChildren(),
        api.getParentNotifications(),
        api.getParentVerificationRequests().catch(() => ({ requests: [] })),
        api.getActiveSchools().catch(() => ({ schools: [] })),
      ]);
      setChildren(kidsRes.children || []);
      setNotifications(notifsRes.notifications || []);
      setVerificationRequests(reqsRes.requests || []);
      setAvailableSchools(schoolsRes.schools || []);

      // If active trip exists, subscribe to live WebSocket stream
      const activeChild = kidsRes.children?.[0];
      if (activeChild?.activeTrip?.trip_id) {
        realtime.subscribeTrip(activeChild.activeTrip.trip_id);
      }
    } catch (err) {
      console.error('Failed to load parent portal data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      const [kidsRes, reqsRes] = await Promise.all([
        api.getParentChildren(),
        api.getParentVerificationRequests().catch(() => ({ requests: [] })),
      ]);
      setChildren(kidsRes.children || []);
      setVerificationRequests(reqsRes.requests || []);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqError(null);
    if (!reqSchoolCode.trim()) {
      setReqError('Please select or enter a valid School Code.');
      return;
    }
    if (!reqStudentAdmNo.trim()) {
      setReqError('Please enter Student Admission Number.');
      return;
    }
    setSubmittingReq(true);
    try {
      const res = await api.requestSchoolVerification({
        schoolCode: reqSchoolCode.trim(),
        studentAdmissionNumber: reqStudentAdmNo.trim(),
        studentName: reqStudentName.trim(),
        parentName: reqParentName.trim(),
        relationship: reqRelationship,
      });
      alert(res.message || 'Verification request submitted to school administration.');
      setRequestModalOpen(false);
      setReqSchoolCode('');
      setReqStudentAdmNo('');
      setReqStudentName('');
      setReqParentName('');
      setReqError(null);
      loadParentData();
    } catch (err: any) {
      setReqError(err.message || 'Failed to submit verification request. Please check details and try again.');
    } finally {
      setSubmittingReq(false);
    }
  };

  // Listen to realtime updates
  useEffect(() => {
    const unsub = realtime.onMessage((msg) => {
      if (msg.type === 'LOCATION_UPDATE') {
        setChildren((prev) =>
          prev.map((c) => {
            if (c.activeTrip?.trip_id === msg.tripId) {
              return {
                ...c,
                latestLocation: msg.payload,
                freshness: { secondsAgo: 0, isStale: false, lastUpdated: msg.payload.recordedAt },
              };
            }
            return c;
          })
        );
      } else if (msg.type === 'ATTENDANCE_EVENT' || msg.type === 'TRIP_STATUS_CHANGED') {
        api.getParentChildren().then((res) => setChildren(res.children || []));
        api.getParentNotifications().then((res) => setNotifications(res.notifications || []));
      }
    });
    return () => unsub();
  }, []);

  const child = children[selectedChildIndex];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-linear-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white p-6 rounded-2xl shadow-lg border border-indigo-700/50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
              <ShieldCheck className="w-4 h-4" />
              <span>SurakshaVahan Parent Safety Portal</span>
            </div>
            <h1 className="text-2xl font-bold">Safe Child Transit Tracking</h1>
            <p className="text-xs text-indigo-200 mt-1">
              Real-time GPS vehicle location, boarding alerts, and stop verification
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Request Link to School Button */}
            <button
              onClick={() => setRequestModalOpen(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs shadow-md transition cursor-pointer flex items-center space-x-1.5"
            >
              <Users className="w-4 h-4" />
              <span>+ Register / Link Student</span>
            </button>

            {/* Child Selector Tabs */}
            {children.length > 1 && (
              <div className="flex gap-2">
                {children.map((c, idx) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedChildIndex(idx)}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                      selectedChildIndex === idx
                        ? 'bg-white text-indigo-900 shadow-md'
                        : 'bg-white/10 hover:bg-white/20 text-white'
                    }`}
                  >
                    {c.full_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Verification Status Banners */}
      {verificationRequests.length > 0 && (
        <div className="space-y-3">
          {verificationRequests.map((req) => (
            <div
              key={req.id}
              className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                req.status === 'PENDING'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : req.status === 'APPROVED'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="flex items-start space-x-2">
                <AlertCircle className={`w-4 h-4 shrink-0 mt-0.5 ${
                  req.status === 'PENDING' ? 'text-amber-600' : req.status === 'APPROVED' ? 'text-emerald-600' : 'text-rose-600'
                }`} />
                <div>
                  <span className="font-bold">
                    School Verification Request ({req.school_name} - Adm: {req.student_admission_number}):
                  </span>{' '}
                  {req.status === 'PENDING' && (
                    <span>Pending school administrator verification and approval. Live tracking will activate automatically once approved.</span>
                  )}
                  {req.status === 'APPROVED' && (
                    <span>Approved! Your account is linked to {req.school_name}.</span>
                  )}
                  {req.status === 'REJECTED' && (
                    <span>Declined/Cancelled by school office. {req.rejection_reason ? `Reason: ${req.rejection_reason}` : ''}</span>
                  )}
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                req.status === 'PENDING' ? 'bg-amber-200 text-amber-900' : req.status === 'APPROVED' ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'
              }`}>
                {req.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-24 text-center text-slate-500 flex flex-col items-center">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
          <span>Loading student transit details...</span>
        </div>
      ) : !child ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-700">No Linked Students Found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Your account is currently not mapped to any active student records. Please contact your school administration
            to link your mobile number.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Live Map & Trip Status */}
          <div className="lg:col-span-2 space-y-6">
            {/* Live Map Box */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 animate-ping"></div>
                  <h3 className="font-bold text-slate-800 text-sm">
                    {child.activeTrip ? `Bus #${child.activeTrip.bus_number} Live Location` : 'Route Map & Designated Stop'}
                  </h3>
                </div>

                <button
                  onClick={handleManualRefresh}
                  disabled={refreshing}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {child.activeTrip && child.latestLocation ? (
                <MapViewer
                  height="400px"
                  center={[child.latestLocation.latitude, child.latestLocation.longitude]}
                  stops={[
                    {
                      id: 'child_morning_stop',
                      name: child.morning_stop_name || 'Pickup Stop',
                      sequence: 1,
                      latitude: child.morning_stop_lat || 28.5355,
                      longitude: child.morning_stop_lng || 77.2081,
                      time: child.morning_scheduled_time,
                    },
                  ]}
                  vehicleLocation={{
                    latitude: child.latestLocation.latitude,
                    longitude: child.latestLocation.longitude,
                    speedKmh: child.latestLocation.speed_kmh,
                    heading: child.latestLocation.heading,
                    busNumber: child.activeTrip.bus_number,
                    recordedAt: child.latestLocation.recorded_at,
                    isStale: child.freshness?.isStale,
                  }}
                />
              ) : (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300">
                  <Bus className="w-12 h-12 text-slate-400 mx-auto mb-2" />
                  <h4 className="font-bold text-slate-700 text-sm">No Active Bus Trip Running Right Now</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    Live GPS map updates are broadcast when the driver starts the journey (e.g. morning pickup or afternoon drop-off).
                  </p>
                  <div className="mt-4 text-xs font-semibold text-indigo-700">
                    Scheduled Morning Pickup: {child.morning_scheduled_time || '07:15 AM'} at {child.morning_stop_name}
                  </div>
                </div>
              )}
            </div>

            {/* Student & Assigned Transit Details */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
              <h3 className="font-bold text-slate-800 text-sm mb-4">Assigned Route & Stop Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">
                    Morning Pickup Route
                  </span>
                  <div className="mt-1 font-bold text-slate-800 text-sm">
                    {child.morning_route_code} - {child.morning_route_name}
                  </div>
                  <div className="text-xs text-slate-600 mt-1 flex items-center space-x-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>Stop: <strong>{child.morning_stop_name}</strong></span>
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5 flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Scheduled Time: <strong>{child.morning_scheduled_time || 'N/A'}</strong></span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">
                    Afternoon Drop-off Route
                  </span>
                  <div className="mt-1 font-bold text-slate-800 text-sm">
                    {child.evening_route_code || child.morning_route_code} - {child.evening_route_name || child.morning_route_name}
                  </div>
                  <div className="text-xs text-slate-600 mt-1 flex items-center space-x-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>Stop: <strong>{child.evening_stop_name || child.morning_stop_name}</strong></span>
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5 flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Scheduled Time: <strong>{child.evening_scheduled_time || 'N/A'}</strong></span>
                  </div>
                </div>
              </div>

              {/* School emergency contact */}
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>School: <strong>{child.school_name}</strong></span>
                <span className="flex items-center space-x-1 text-slate-700">
                  <Phone className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Transport Helpdesk: <strong>{child.school_phone}</strong></span>
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Attendance Activity & Safety Alerts */}
          <div className="space-y-6">
            {/* Child Profile Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl font-bold shadow-md">
                  {child.full_name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-base">{child.full_name}</h3>
                  <p className="text-xs text-slate-500">
                    Adm: <strong className="text-slate-700">{child.admission_number}</strong> • Class: {child.grade}-{child.section}
                  </p>
                  <p className="text-xs text-indigo-600 font-semibold mt-0.5">
                    {child.relationship_type || 'Child'}
                  </p>
                </div>
              </div>
            </div>

            {/* Today's Attendance Timeline */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <h3 className="font-bold text-slate-800 text-sm mb-3">Today's Transit Events</h3>

              {child.attendanceToday?.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  No boarding or drop-off scans recorded yet today.
                </div>
              ) : (
                <div className="space-y-3">
                  {child.attendanceToday.map((event: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-start space-x-3 p-3 rounded-xl bg-slate-50 border border-slate-200"
                    >
                      <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg shrink-0 mt-0.5">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800">
                            {event.event_type === 'BOARDING' ? 'Boarded School Bus' : 'Dropped Off Safely'}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(event.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          At {event.stop_name || 'Designated Stop'} ({event.scan_method} Verified)
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notifications Feed */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
                  <Bell className="w-4 h-4 text-indigo-600" />
                  <span>Transit Notifications</span>
                </h3>
              </div>

              {notifications.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">No alerts or messages</div>
              ) : (
                <div className="space-y-2.5 max-h-60 overflow-y-auto">
                  {notifications.slice(0, 10).map((n) => (
                    <div key={n.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200/60">
                      <div className="flex justify-between items-start">
                        <h4 className="text-xs font-bold text-slate-800">{n.title}</h4>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          n.delivery_status === 'DELIVERED_IN_APP' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {n.delivery_status === 'DELIVERED_IN_APP' ? 'In-App Verified' : (n.delivery_status || 'Sent')}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1">{n.message}</p>
                      <span className="text-[10px] text-slate-400 block mt-1">
                        {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Request School Verification Modal */}
      {requestModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <div className="flex items-center space-x-2 text-indigo-600 mb-1">
              <Users className="w-5 h-5" />
              <h3 className="font-bold text-slate-800 text-base">Request School Verification</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Submit your student's admission number and school code to request live transit tracking authorization from school administration.
            </p>

            {reqError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{reqError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitRequest} className="space-y-3">
              {availableSchools.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Select Active School</label>
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        setReqSchoolCode(e.target.value);
                      }
                    }}
                    value={reqSchoolCode}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  >
                    <option value="">-- Choose School from System List --</option>
                    {availableSchools.map((s) => (
                      <option key={s.id} value={s.code}>
                        {s.name} ({s.code}) - {s.city}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">School Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. DPS-RKP or RYAN-VK"
                  value={reqSchoolCode}
                  onChange={(e) => setReqSchoolCode(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 uppercase font-mono"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Unique school identifier code provided by your school office.</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Student Admission Number *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. DPS-2022-0412"
                  value={reqStudentAdmNo}
                  onChange={(e) => setReqStudentAdmNo(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Student Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Aarav Sharma"
                  value={reqStudentName}
                  onChange={(e) => setReqStudentName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Full Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Amit Sharma"
                    value={reqParentName}
                    onChange={(e) => setReqParentName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Relationship</label>
                  <select
                    value={reqRelationship}
                    onChange={(e) => setReqRelationship(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  >
                    <option value="FATHER">Father</option>
                    <option value="MOTHER">Mother</option>
                    <option value="GUARDIAN">Guardian</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={submittingReq}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {submittingReq ? 'Submitting...' : 'Submit Request'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRequestModalOpen(false);
                    setReqError(null);
                  }}
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
