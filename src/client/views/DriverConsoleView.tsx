import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.ts';
import { realtime } from '../services/ws.ts';
import { MapViewer } from '../components/MapViewer.tsx';
import {
  Bus,
  Play,
  CheckCircle,
  QrCode,
  AlertTriangle,
  Radio,
  Navigation,
  MapPin,
  Clock,
  ShieldAlert,
} from 'lucide-react';

export const DriverConsoleView: React.FC = () => {
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string>('');
  const [tripDetails, setTripDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [qrInput, setQrInput] = useState('');
  const [manualStudentId, setManualStudentId] = useState('');
  const [manualEventType, setManualEventType] = useState<'BOARDING' | 'DROP_OFF'>('BOARDING');
  const [manualReason, setManualReason] = useState('Damaged physical QR card verified by driver');
  const [scanResult, setScanResult] = useState<{ success: boolean; message: string } | null>(null);

  // GPS Transmitter state
  const [isTransmittingGps, setIsTransmittingGps] = useState(false);
  const [gpsSimIndex, setGpsSimIndex] = useState(0);
  const [latestGps, setLatestGps] = useState<any>(null);
  const gpsIntervalRef = useRef<any>(null);

  // Reconciliation Modal
  const [reconcileModalOpen, setReconcileModalOpen] = useState(false);
  const [physicalCheckConfirmed, setPhysicalCheckConfirmed] = useState(false);
  const [reconciliationNotes, setReconciliationNotes] = useState('');

  useEffect(() => {
    loadTrips();
    return () => {
      clearInterval(gpsIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (selectedTripId) {
      loadTripDetails(selectedTripId);
      realtime.subscribeTrip(selectedTripId);
      return () => {
        realtime.unsubscribeTrip(selectedTripId);
      };
    }
  }, [selectedTripId]);

  // Listen to attendance & status changes over WS
  useEffect(() => {
    const unsubscribe = realtime.onMessage((msg) => {
      if (msg.type === 'ATTENDANCE_EVENT' || msg.type === 'TRIP_STATUS_CHANGED') {
        if (selectedTripId) {
          loadTripDetails(selectedTripId);
        }
      }
    });
    return () => unsubscribe();
  }, [selectedTripId]);

  const loadTrips = async () => {
    try {
      const res = await api.getTrips();
      setTrips(res.trips || []);
      // Auto-select in-progress or first trip
      const inProg = res.trips.find((t: any) => t.status === 'IN_PROGRESS');
      if (inProg) {
        setSelectedTripId(inProg.id);
      } else if (res.trips.length > 0) {
        setSelectedTripId(res.trips[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadTripDetails = async (id: string) => {
    setLoading(true);
    try {
      const res = await api.getTrip(id);
      setTripDetails(res);
      if (res.latestLocation) {
        setLatestGps(res.latestLocation);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartTrip = async () => {
    if (!selectedTripId) return;
    setActionLoading(true);
    try {
      await api.startTrip(selectedTripId);
      alert('Trip Started! GPS transmission and parent live streams are now active.');
      loadTripDetails(selectedTripId);
      loadTrips();
    } catch (err: any) {
      alert(err.message || 'Failed to start trip');
    } finally {
      setActionLoading(false);
    }
  };

  // Toggle GPS ingestion / transmitter
  const toggleGpsTransmitter = () => {
    if (isTransmittingGps) {
      clearInterval(gpsIntervalRef.current);
      setIsTransmittingGps(false);
    } else {
      setIsTransmittingGps(true);
      // Ingest immediate point and setup 5-second interval
      sendNextGpsPoint();
      gpsIntervalRef.current = setInterval(() => {
        sendNextGpsPoint();
      }, 5000);
    }
  };

  const sendNextGpsPoint = async () => {
    if (!selectedTripId || !tripDetails?.stops) return;
    const stops = tripDetails.stops;
    if (stops.length === 0) return;

    // Simulate movement between stops along the route path
    const currentStop = stops[gpsSimIndex % stops.length];
    // Slightly interpolate coordinates for realism
    const lat = currentStop.latitude + (Math.random() - 0.5) * 0.0015;
    const lng = currentStop.longitude + (Math.random() - 0.5) * 0.0015;
    const speed = Math.floor(25 + Math.random() * 20);
    const heading = Math.floor(Math.random() * 360);

    try {
      await api.ingestGpsLocation(selectedTripId, {
        latitude: lat,
        longitude: lng,
        speedKmh: speed,
        heading,
        accuracyMeters: 4.5,
      });

      setLatestGps({
        latitude: lat,
        longitude: lng,
        speedKmh: speed,
        heading,
        recorded_at: new Date().toISOString(),
        busNumber: tripDetails.trip.bus_number,
      });

      setGpsSimIndex((prev) => (prev + 1) % stops.length);
    } catch (err) {
      console.error('GPS telemetry error:', err);
    }
  };

  const handleScanQr = async (payloadToScan?: string) => {
    const raw = payloadToScan || qrInput;
    if (!raw.trim()) return;

    setActionLoading(true);
    setScanResult(null);
    try {
      const res = await api.scanAttendanceQr(selectedTripId, {
        qrPayload: raw.trim(),
        latitude: latestGps?.latitude,
        longitude: latestGps?.longitude,
      });
      setScanResult({ success: true, message: res.message });
      setQrInput('');
      loadTripDetails(selectedTripId);
    } catch (err: any) {
      setScanResult({ success: false, message: err.message || 'Scan failed' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualAttendance = async () => {
    if (!manualStudentId) return;
    setActionLoading(true);
    try {
      await api.manualAttendanceOverride(selectedTripId, {
        studentId: manualStudentId,
        eventType: manualEventType,
        manualReason,
        latitude: latestGps?.latitude,
        longitude: latestGps?.longitude,
      });
      alert(`Manual ${manualEventType} recorded and audited.`);
      setManualModalOpen(false);
      loadTripDetails(selectedTripId);
    } catch (err: any) {
      alert(err.message || 'Manual attendance failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteTrip = async () => {
    if (!selectedTripId) return;
    if (!physicalCheckConfirmed) {
      alert('You must inspect the bus interior and check the physical safety confirmation box.');
      return;
    }

    setActionLoading(true);
    try {
      await api.completeTrip(selectedTripId, {
        physicalCheckConfirmed: true,
        reconciliationNotes,
      });
      alert('Trip successfully completed! Passenger attendance reconciled.');
      setReconcileModalOpen(false);
      clearInterval(gpsIntervalRef.current);
      setIsTransmittingGps(false);
      loadTripDetails(selectedTripId);
      loadTrips();
    } catch (err: any) {
      alert(err.message || 'Failed to complete trip');
    } finally {
      setActionLoading(false);
    }
  };

  const trip = tripDetails?.trip;
  const stops = tripDetails?.stops || [];
  const students = tripDetails?.expectedStudents || [];

  const boardedCount = students.filter((s: any) => s.boarding_status === 'BOARDING').length;
  const droppedCount = students.filter((s: any) => s.dropoff_status === 'DROP_OFF').length;

  return (
    <div className="space-y-6">
      {/* Top Header / Selector */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-indigo-700 font-bold text-xs uppercase tracking-wider mb-1">
            <Bus className="w-4 h-4" />
            <span>Driver & In-Vehicle Telemetry Console</span>
          </div>
          <h1 className="text-xl font-bold text-slate-800">
            {trip ? `${trip.bus_number} • ${trip.route_name}` : 'Select Operational Trip'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time GPS ingestion, QR passenger boarding, and safety reconciliation
          </p>
        </div>

        {/* Trip Switcher */}
        <div className="flex items-center space-x-3">
          <select
            value={selectedTripId}
            onChange={(e) => setSelectedTripId(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          >
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.bus_number} - {t.route_name} ({t.status})
              </option>
            ))}
          </select>

          {trip && trip.status === 'SCHEDULED' && (
            <button
              onClick={handleStartTrip}
              disabled={actionLoading}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>Start Trip</span>
            </button>
          )}

          {trip && trip.status === 'IN_PROGRESS' && (
            <button
              onClick={() => setReconcileModalOpen(true)}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold shadow-sm transition cursor-pointer"
            >
              <CheckCircle className="w-4 h-4" />
              <span>Complete Trip</span>
            </button>
          )}
        </div>
      </div>

      {loading && !tripDetails ? (
        <div className="py-20 text-center text-slate-500">Loading trip telemetry...</div>
      ) : trip ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Live Map & GPS Transmitter */}
          <div className="lg:col-span-2 space-y-6">
            {/* Live Interactive Map */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center space-x-2">
                  <Navigation className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Bus Route & Live Waypoints
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  {/* GPS Transmitter Button */}
                  <button
                    onClick={toggleGpsTransmitter}
                    className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      isTransmittingGps
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <Radio className={`w-3.5 h-3.5 ${isTransmittingGps ? 'animate-pulse text-emerald-600' : ''}`} />
                    <span>{isTransmittingGps ? 'GPS Ingesting (5s)' : 'Transmit GPS Pings'}</span>
                  </button>
                </div>
              </div>

              <MapViewer
                height="380px"
                stops={stops.map((s: any) => ({
                  id: s.id,
                  name: s.stop_name,
                  sequence: s.stop_order,
                  latitude: s.latitude,
                  longitude: s.longitude,
                  time: trip.trip_type === 'EVENING_DROP' ? s.evening_scheduled_time : s.morning_scheduled_time,
                  status: s.status,
                  geofenceMeters: s.geofence_radius_meters,
                }))}
                vehicleLocation={
                  latestGps
                    ? {
                        latitude: latestGps.latitude,
                        longitude: latestGps.longitude,
                        speedKmh: latestGps.speed_kmh,
                        heading: latestGps.heading,
                        busNumber: trip.bus_number,
                        recordedAt: latestGps.recorded_at,
                      }
                    : null
                }
              />
            </div>

            {/* Stops Progress Sequence */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
              <h3 className="font-bold text-slate-800 text-sm mb-4 flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-indigo-600" />
                <span>Route Stops Progression</span>
              </h3>

              <div className="space-y-3">
                {stops.map((st: any) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/60"
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                          st.status === 'DEPARTED'
                            ? 'bg-emerald-600 text-white'
                            : st.status === 'ARRIVED'
                            ? 'bg-amber-500 text-white'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {st.stop_order}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">{st.stop_name}</h4>
                        <p className="text-[11px] text-slate-500">
                          {st.landmark ? `${st.landmark} • ` : ''}
                          Scheduled: {trip.trip_type === 'EVENING_DROP' ? st.evening_scheduled_time : st.morning_scheduled_time || 'N/A'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        st.status === 'DEPARTED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : st.status === 'ARRIVED'
                          ? 'bg-amber-100 text-amber-800 animate-pulse'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {st.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Attendance & QR Scanner */}
          <div className="space-y-6">
            {/* Quick Stats Banner */}
            <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-md">
              <div className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-3">
                Passenger Attendance Status
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/10 p-3 rounded-xl">
                  <span className="text-2xl font-bold text-emerald-400">{boardedCount}</span>
                  <div className="text-[11px] text-slate-300">Boarded on Bus</div>
                </div>
                <div className="bg-white/10 p-3 rounded-xl">
                  <span className="text-2xl font-bold text-amber-400">{droppedCount}</span>
                  <div className="text-[11px] text-slate-300">Dropped Off</div>
                </div>
              </div>
              <div className="mt-4 text-xs text-slate-300">
                Total Assigned Students: <strong>{students.length}</strong>
              </div>

              {trip.status === 'IN_PROGRESS' && (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setScanModalOpen(true)}
                    className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Scan QR Badge</span>
                  </button>
                  <button
                    onClick={() => setManualModalOpen(true)}
                    className="py-2 px-3 bg-white/20 hover:bg-white/30 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                  >
                    Manual Fallback
                  </button>
                </div>
              )}
            </div>

            {/* Passenger Roster Checklist */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
              <h3 className="font-bold text-slate-800 text-sm mb-3">Student Manifest ({students.length})</h3>
              <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
                {students.map((st: any) => (
                  <div key={st.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">{st.full_name}</h4>
                      <p className="text-[11px] text-slate-500">
                        {st.grade}-{st.section} • {st.assigned_stop_name}
                      </p>
                    </div>

                    <div className="text-right">
                      {st.dropoff_status === 'DROP_OFF' ? (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                          DROPPED
                        </span>
                      ) : st.boarding_status === 'BOARDING' ? (
                        <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                          ON BUS
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                          WAITING
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* QR Scanner Modal (Simulated / Camera Test) */}
      {scanModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1 flex items-center space-x-2">
              <QrCode className="w-5 h-5 text-indigo-600" />
              <span>Bus Attendant QR Scanner</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Simulates camera scan input or accepts opaque token from student ID badge
            </p>

            {scanResult && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold mb-4 ${
                  scanResult.success ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                }`}
              >
                {scanResult.message}
              </div>
            )}

            {/* Quick Roster Scan Selector for quick testing */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Quick Student Scan (Click to Scan):
              </label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {students.map((st: any) => (
                  <button
                    key={st.id}
                    onClick={() => handleScanQr(`SURAKSHA_VAHAN:qr_${st.id}:AUTO_HASH`)}
                    className="w-full text-left p-2 rounded-lg bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 text-xs flex justify-between items-center transition"
                  >
                    <span className="font-semibold text-slate-800">{st.full_name}</span>
                    <span className="text-[10px] text-slate-500 font-mono">Adm: {st.admission_number}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Or Paste/Scan Raw Opaque Token:
                </label>
                <input
                  type="text"
                  placeholder="SURAKSHA_VAHAN:qr_stu_01:... or SVQR_..."
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleScanQr()}
                  disabled={actionLoading || !qrInput.trim()}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Verify & Record Event
                </button>
                <button
                  onClick={() => {
                    setScanModalOpen(false);
                    setScanResult(null);
                  }}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Attendance Fallback Modal */}
      {manualModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1 flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              <span>Manual Attendance Fallback</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Audited override for damaged/missing student QR card
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Student:</label>
                <select
                  value={manualStudentId}
                  onChange={(e) => setManualStudentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Choose Student --</option>
                  {students.map((st: any) => (
                    <option key={st.id} value={st.id}>
                      {st.full_name} ({st.admission_number} - {st.grade})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Event Type:</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setManualEventType('BOARDING')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border ${
                      manualEventType === 'BOARDING'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Boarding
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualEventType('DROP_OFF')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border ${
                      manualEventType === 'DROP_OFF'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Drop-off
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mandatory Audit Reason:
                </label>
                <textarea
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleManualAttendance}
                  disabled={actionLoading || !manualStudentId}
                  className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Confirm & Audit Override
                </button>
                <button
                  onClick={() => setManualModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trip End Safety Reconciliation Modal */}
      {reconcileModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1 flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
              <span>Trip-End Physical Inspection & Reconciliation</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Mandatory safety check under Indian school transport regulations
            </p>

            {/* Reconciliation Warning if student boarded without drop-off */}
            {boardedCount > droppedCount && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-4 flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <div>
                  <strong>Reconciliation Exception:</strong> {boardedCount - droppedCount} student(s) boarded this bus
                  but have no drop-off scan recorded. You must provide mandatory reconciliation notes.
                </div>
              </div>
            )}

            <div className="space-y-4">
              <label className="flex items-start space-x-3 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={physicalCheckConfirmed}
                  onChange={(e) => setPhysicalCheckConfirmed(e.target.checked)}
                  className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  <strong>Physical Bus Check Verified:</strong> I hereby certify that I have walked the entire length of
                  the bus aisle, inspected all seat rows, and confirmed that zero children or unattended bags remain inside
                  the vehicle.
                </span>
              </label>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Trip Completion / Resolution Notes:
                </label>
                <textarea
                  value={reconciliationNotes}
                  onChange={(e) => setReconciliationNotes(e.target.value)}
                  placeholder="e.g. All students safely handed over at gates / parent received"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleCompleteTrip}
                  disabled={actionLoading || !physicalCheckConfirmed}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Confirm Physical Check & End Trip
                </button>
                <button
                  onClick={() => setReconcileModalOpen(false)}
                  className="px-4 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
