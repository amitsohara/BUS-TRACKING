import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { Bus, Plus, Play, CheckCircle, Clock, Calendar, AlertCircle } from 'lucide-react';

interface TripsMonitorViewProps {
  onNavigateToConsole: (tripId?: string) => void;
}

export const TripsMonitorView: React.FC<TripsMonitorViewProps> = ({ onNavigateToConsole }) => {
  const [trips, setTrips] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);

  // Form options
  const [routes, setRoutes] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);

  // Schedule Form State
  const [routeId, setRouteId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [tripType, setTripType] = useState('MORNING_PICKUP');
  const [tripDate, setTripDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduledStartTime, setScheduledStartTime] = useState('06:45');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadTrips();
    api.getRoutes().then((res) => setRoutes(res.routes || [])).catch(console.error);
    api.getVehicles().then((res) => setVehicles(res.vehicles || [])).catch(console.error);
    api.getDrivers().then((res) => setDrivers(res.drivers || [])).catch(console.error);
  }, [statusFilter]);

  const loadTrips = async () => {
    setLoading(true);
    try {
      const res = await api.getTrips({ status: statusFilter || undefined });
      setTrips(res.trips || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.scheduleTrip({
        routeId,
        vehicleId,
        driverId,
        tripType,
        tripDate,
        scheduledStartTime,
        notes,
      });
      alert('Trip scheduled successfully.');
      setScheduleModalOpen(false);
      loadTrips();
    } catch (err: any) {
      alert(err.message || 'Failed to schedule trip');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Bus className="w-5 h-5 text-indigo-600" />
            <span>Trip Dispatch & Fleet Scheduling</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitor scheduled, in-progress, and completed transport runs with live reconciliation
          </p>
        </div>

        <button
          onClick={() => setScheduleModalOpen(true)}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Schedule New Trip</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {[
          { label: 'All Trips', value: '' },
          { label: 'Live (In-Progress)', value: 'IN_PROGRESS' },
          { label: 'Scheduled', value: 'SCHEDULED' },
          { label: 'Completed', value: 'COMPLETED' },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              statusFilter === tab.value
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Trips List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-3 py-16 text-center text-slate-400">Loading trips...</div>
        ) : trips.length === 0 ? (
          <div className="col-span-3 py-16 text-center text-slate-400">No trips matching filter.</div>
        ) : (
          trips.map((t) => (
            <div key={t.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md font-mono">
                  {t.route_code}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    t.status === 'IN_PROGRESS'
                      ? 'bg-emerald-100 text-emerald-800 animate-pulse'
                      : t.status === 'COMPLETED'
                      ? 'bg-slate-100 text-slate-600'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {t.status}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-800">{t.route_name}</h3>
                <p className="text-xs text-slate-500">
                  {t.trip_type.replace('_', ' ')} • Date: {t.trip_date}
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Bus & Driver:</span>
                  <span className="font-semibold text-slate-700">
                    {t.bus_number} ({t.driver_name})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Scheduled Time:</span>
                  <span className="font-semibold text-slate-700">{t.scheduled_start_time}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Attendance:</span>
                  <span className="font-semibold text-slate-700">
                    {t.boarded_count} Boarded • {t.dropped_count} Dropped
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {t.total_stops} Sequenced Stops
                </span>

                <button
                  onClick={() => onNavigateToConsole(t.id)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  {t.status === 'IN_PROGRESS' ? 'Track Live' : 'Open Console'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Schedule Trip Modal */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1">Schedule Bus Run</h3>
            <p className="text-xs text-slate-500 mb-4">Assigns vehicle and driver to a configured route</p>

            <form onSubmit={handleScheduleTrip} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Route *</label>
                <select
                  required
                  value={routeId}
                  onChange={(e) => setRouteId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                >
                  <option value="">-- Choose Route --</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.route_code} - {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Assign Bus *</label>
                  <select
                    required
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  >
                    <option value="">-- Choose Vehicle --</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.bus_number} ({v.registration_number})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Assign Driver *</label>
                  <select
                    required
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  >
                    <option value="">-- Choose Driver --</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.full_name} ({d.phone})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Trip Type</label>
                  <select
                    value={tripType}
                    onChange={(e) => setTripType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  >
                    <option value="MORNING_PICKUP">Morning Pickup</option>
                    <option value="EVENING_DROP">Evening Drop</option>
                    <option value="SPECIAL">Special Event</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Trip Date</label>
                  <input
                    type="date"
                    required
                    value={tripDate}
                    onChange={(e) => setTripDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    required
                    value={scheduledStartTime}
                    onChange={(e) => setScheduledStartTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Operational Notes</label>
                <input
                  type="text"
                  placeholder="Optional driver instructions or detour notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {submitting ? 'Scheduling...' : 'Schedule Trip'}
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
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
