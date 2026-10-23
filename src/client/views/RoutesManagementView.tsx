import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { MapViewer } from '../components/MapViewer.tsx';
import { Route, Plus, MapPin, Clock, Bus, User, ChevronRight, Edit2 } from 'lucide-react';

export const RoutesManagementView: React.FC = () => {
  const [routes, setRoutes] = useState<any[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [routeDetails, setRouteDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Modals
  const [createRouteModal, setCreateRouteModal] = useState(false);
  const [editRouteModal, setEditRouteModal] = useState<any | null>(null);
  const [addStopModal, setAddStopModal] = useState(false);

  // Route Form State
  const [routeCode, setRouteCode] = useState('');
  const [routeName, setRouteName] = useState('');
  const [description, setDescription] = useState('');
  const [morningStart, setMorningStart] = useState('06:45');
  const [eveningStart, setEveningStart] = useState('14:15');

  // Edit Route Form State
  const [editRouteCode, setEditRouteCode] = useState('');
  const [editRouteName, setEditRouteName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMorningStart, setEditMorningStart] = useState('06:45');
  const [editEveningStart, setEditEveningStart] = useState('14:15');

  // Stop Form State
  const [stopName, setStopName] = useState('');
  const [landmark, setLandmark] = useState('');
  const [latitude, setLatitude] = useState('28.5355');
  const [longitude, setLongitude] = useState('77.2081');
  const [mTime, setMTime] = useState('07:15');
  const [eTime, setETime] = useState('14:45');
  const [geofence, setGeofence] = useState('50');

  useEffect(() => {
    loadRoutes();
  }, []);

  useEffect(() => {
    if (selectedRouteId) {
      loadRouteDetails(selectedRouteId);
    }
  }, [selectedRouteId]);

  const loadRoutes = async () => {
    setLoading(true);
    try {
      const res = await api.getRoutes();
      setRoutes(res.routes || []);
      if (res.routes?.length > 0 && !selectedRouteId) {
        setSelectedRouteId(res.routes[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadRouteDetails = async (id: string) => {
    try {
      const res = await api.getRoute(id);
      setRouteDetails(res);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createRoute({
        routeCode,
        name: routeName,
        description,
        morningStartTime: morningStart,
        eveningStartTime: eveningStart,
      });
      alert('Route created successfully.');
      setCreateRouteModal(false);
      setRouteCode('');
      setRouteName('');
      loadRoutes();
    } catch (err: any) {
      alert(err.message || 'Failed to create route');
    }
  };

  const handleOpenEditRoute = (r: any) => {
    setEditRouteModal(r);
    setEditRouteCode(r.route_code || '');
    setEditRouteName(r.name || '');
    setEditDescription(r.description || '');
    setEditMorningStart(r.morning_start_time || '06:45');
    setEditEveningStart(r.evening_start_time || '14:15');
  };

  const handleUpdateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editRouteModal) return;
    try {
      await api.updateRoute(editRouteModal.id, {
        routeCode: editRouteCode,
        name: editRouteName,
        description: editDescription,
        morningStartTime: editMorningStart,
        eveningStartTime: editEveningStart,
      });
      alert('Route details updated successfully.');
      setEditRouteModal(null);
      loadRoutes();
      if (selectedRouteId === editRouteModal.id) {
        loadRouteDetails(editRouteModal.id);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update route');
    }
  };

  const handleAddStop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRouteId) return;
    try {
      await api.addRouteStop(selectedRouteId, {
        stopName,
        landmark,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        morningScheduledTime: mTime,
        eveningScheduledTime: eTime,
        geofenceRadiusMeters: parseInt(geofence, 10),
      });
      alert('Stop added to route.');
      setAddStopModal(false);
      setStopName('');
      loadRouteDetails(selectedRouteId);
      loadRoutes();
    } catch (err: any) {
      alert(err.message || 'Failed to add stop');
    }
  };

  const route = routeDetails?.route;
  const stops = routeDetails?.stops || [];

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Route className="w-5 h-5 text-indigo-600" />
            <span>Routes & Stop Waypoints</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Geofenced bus stops, morning/evening schedules, and student assignments
          </p>
        </div>

        <button
          onClick={() => setCreateRouteModal(true)}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Create New Route</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Routes List */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
          <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider px-2 py-1">
            Configured Routes ({routes.length})
          </h3>

          <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
            {routes.map((r) => (
              <div
                key={r.id}
                onClick={() => setSelectedRouteId(r.id)}
                className={`p-3 rounded-xl border transition cursor-pointer ${
                  selectedRouteId === r.id
                    ? 'bg-indigo-50/80 border-indigo-400 text-indigo-900'
                    : 'bg-slate-50/50 hover:bg-slate-100 border-slate-200 text-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs">{r.route_code}</span>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] text-slate-500 font-semibold">{r.stops_count} Stops</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditRoute(r);
                      }}
                      className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-100 rounded transition cursor-pointer"
                      title="Edit Route Details"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="text-xs font-semibold mt-1 truncate">{r.name}</div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                  <span>{r.assigned_students_count || 0} Students</span>
                  <span>{r.bus_number || 'Unassigned'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Route Details & Map */}
        <div className="lg:col-span-2 space-y-6">
          {route ? (
            <>
              {/* Map View of Stops */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between mb-3 px-1">
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
                      <span>{route.route_code}: {route.name}</span>
                      <button
                        onClick={() => handleOpenEditRoute(route)}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition cursor-pointer"
                        title="Edit Route"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </h3>
                    <p className="text-xs text-slate-500">{route.description || 'All sequenced stops on route'}</p>
                  </div>
                  <button
                    onClick={() => setAddStopModal(true)}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Stop</span>
                  </button>
                </div>

                <MapViewer
                  height="340px"
                  stops={stops.map((s: any) => ({
                    id: s.id,
                    name: s.stop_name,
                    sequence: s.sequence_order,
                    latitude: s.latitude,
                    longitude: s.longitude,
                    time: s.morning_scheduled_time,
                    geofenceMeters: s.geofence_radius_meters,
                  }))}
                />
              </div>

              {/* Stops Table */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                <h4 className="font-bold text-slate-800 text-sm mb-3">Sequenced Stops</h4>
                <div className="divide-y divide-slate-100">
                  {stops.map((st: any) => (
                    <div key={st.id} className="py-2.5 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                          {st.sequence_order}
                        </span>
                        <div>
                          <div className="font-bold text-slate-800 text-xs">{st.stop_name}</div>
                          <span className="text-[11px] text-slate-500">{st.landmark || 'Waypoint'}</span>
                        </div>
                      </div>

                      <div className="text-right text-xs">
                        <div className="text-slate-700 font-mono">
                          Morning: {st.morning_scheduled_time || 'N/A'} • Evening: {st.evening_scheduled_time || 'N/A'}
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {st.students_at_stop || 0} students • {st.geofence_radius_meters}m geofence
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-400">
              Select a route to view its waypoints and map
            </div>
          )}
        </div>
      </div>

      {/* Create Route Modal */}
      {createRouteModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1">Create Bus Route</h3>
            <p className="text-xs text-slate-500 mb-4">Adds a new transit path for the school</p>

            <form onSubmit={handleCreateRoute} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Route Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. R-102"
                  value={routeCode}
                  onChange={(e) => setRouteCode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs uppercase font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Route Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dwarka Sector 10 to RKP"
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  placeholder="Key areas served"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Morning Start</label>
                  <input
                    type="time"
                    value={morningStart}
                    onChange={(e) => setMorningStart(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Evening Start</label>
                  <input
                    type="time"
                    value={eveningStart}
                    onChange={(e) => setEveningStart(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Create Route
                </button>
                <button
                  type="button"
                  onClick={() => setCreateRouteModal(false)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Route Modal */}
      {editRouteModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1">Edit Bus Route</h3>
            <p className="text-xs text-slate-500 mb-4">Editing details for {editRouteModal.route_code}</p>

            <form onSubmit={handleUpdateRoute} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Route Code *</label>
                <input
                  type="text"
                  required
                  value={editRouteCode}
                  onChange={(e) => setEditRouteCode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs uppercase font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Route Name *</label>
                <input
                  type="text"
                  required
                  value={editRouteName}
                  onChange={(e) => setEditRouteName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Morning Start</label>
                  <input
                    type="time"
                    value={editMorningStart}
                    onChange={(e) => setEditMorningStart(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Evening Start</label>
                  <input
                    type="time"
                    value={editEveningStart}
                    onChange={(e) => setEditEveningStart(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Save Route Changes
                </button>
                <button
                  type="button"
                  onClick={() => setEditRouteModal(null)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Stop Modal */}
      {addStopModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1">Add Geofenced Stop</h3>
            <p className="text-xs text-slate-500 mb-4">Adds a scheduled passenger pickup/drop checkpoint</p>

            <form onSubmit={handleAddStop} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Stop Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Green Park Metro Station"
                  value={stopName}
                  onChange={(e) => setStopName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Landmark</label>
                <input
                  type="text"
                  placeholder="e.g. Gate 3 Near Gurudwara"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Latitude *</label>
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Longitude *</label>
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Morning Time</label>
                  <input
                    type="time"
                    value={mTime}
                    onChange={(e) => setMTime(e.target.value)}
                    className="w-full px-2 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Evening Time</label>
                  <input
                    type="time"
                    value={eTime}
                    onChange={(e) => setETime(e.target.value)}
                    className="w-full px-2 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Geofence (m)</label>
                  <input
                    type="number"
                    min={20}
                    max={200}
                    value={geofence}
                    onChange={(e) => setGeofence(e.target.value)}
                    className="w-full px-2 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Add Stop
                </button>
                <button
                  type="button"
                  onClick={() => setAddStopModal(false)}
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
