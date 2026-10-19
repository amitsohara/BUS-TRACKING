import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { Bus, Plus, ShieldCheck, AlertTriangle } from 'lucide-react';

export const VehiclesManagementView: React.FC = () => {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Form state
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [busNumber, setBusNumber] = useState('');
  const [capacity, setCapacity] = useState('42');
  const [model, setModel] = useState('Tata Starbus Ultra');
  const [fuelType, setFuelType] = useState('CNG');
  const [gpsDeviceId, setGpsDeviceId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    setLoading(true);
    try {
      const res = await api.getVehicles();
      setVehicles(res.vehicles || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createVehicle({
        registrationNumber,
        busNumber,
        capacity: parseInt(capacity, 10),
        model,
        fuelType,
        gpsDeviceId,
      });
      alert('Vehicle successfully registered to fleet.');
      setCreateModalOpen(false);
      setRegistrationNumber('');
      setBusNumber('');
      loadVehicles();
    } catch (err: any) {
      alert(err.message || 'Failed to register vehicle');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Bus className="w-5 h-5 text-amber-600" />
            <span>School Bus Fleet Management</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Total {vehicles.length} vehicles registered with GPS devices & capacity limits
          </p>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Bus to Fleet</span>
        </button>
      </div>

      {/* Vehicles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-3 py-16 text-center text-slate-400">Loading fleet records...</div>
        ) : vehicles.length === 0 ? (
          <div className="col-span-3 py-16 text-center text-slate-400">No vehicles registered yet.</div>
        ) : (
          vehicles.map((v) => (
            <div key={v.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-lg">
                  {v.bus_number}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  v.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                }`}>
                  {v.status}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-800 font-mono">{v.registration_number}</h3>
                <p className="text-xs text-slate-500">{v.model} • {v.make}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-100">
                <div className="bg-slate-50 p-2 rounded-lg">
                  <span className="text-slate-400 block text-[10px]">Capacity</span>
                  <span className="font-bold text-slate-700">{v.capacity} Seats</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg">
                  <span className="text-slate-400 block text-[10px]">Fuel Type</span>
                  <span className="font-bold text-slate-700">{v.fuel_type}</span>
                </div>
              </div>

              <div className="text-[11px] text-slate-500 flex justify-between items-center pt-1">
                <span>GPS Device ID: <strong className="font-mono text-slate-700">{v.gps_device_id || 'Embedded'}</strong></span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Register Vehicle Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1">Register Fleet Vehicle</h3>
            <p className="text-xs text-slate-500 mb-4">Adds a verified transport vehicle to the school</p>

            <form onSubmit={handleCreateVehicle} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Registration Number *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. DL-01-EB-4102"
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Bus Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="Bus #05"
                    value={busNumber}
                    onChange={(e) => setBusNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Passenger Capacity *</label>
                  <input
                    type="number"
                    required
                    min={10}
                    max={80}
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Bus Model / Make</label>
                <input
                  type="text"
                  placeholder="Tata Starbus Ultra 42S"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Fuel Type</label>
                  <select
                    value={fuelType}
                    onChange={(e) => setFuelType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                  >
                    <option value="CNG">CNG</option>
                    <option value="DIESEL">DIESEL</option>
                    <option value="ELECTRIC">ELECTRIC</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">GPS Device ID</label>
                  <input
                    type="text"
                    placeholder="GPS-DEL-05"
                    value={gpsDeviceId}
                    onChange={(e) => setGpsDeviceId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {submitting ? 'Registering...' : 'Register Vehicle'}
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
