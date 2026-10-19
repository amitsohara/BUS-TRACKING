import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import { StudentQrBadgeModal } from '../components/StudentQrBadgeModal.tsx';
import {
  Users,
  Search,
  Plus,
  QrCode,
  Edit2,
  Phone,
  Bus,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react';

export const StudentsManagementView: React.FC = () => {
  const [students, setStudents] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [loading, setLoading] = useState(false);

  // Modals
  const [badgeStudentId, setBadgeStudentId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [routes, setRoutes] = useState<any[]>([]);

  // New Student Form State
  const [fullName, setFullName] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [studentGrade, setStudentGrade] = useState('5');
  const [section, setSection] = useState('A');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [bloodGroup, setBloodGroup] = useState('B+');
  const [homeAddress, setHomeAddress] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadStudents(1);
    api.getRoutes().then((res) => setRoutes(res.routes || [])).catch(console.error);
  }, []);

  const loadStudents = async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.getStudents({ search, grade, page, limit: 20 });
      setStudents(res.students || []);
      setPagination(res.pagination || {});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadStudents(1);
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createStudent({
        fullName,
        admissionNumber,
        grade: studentGrade,
        section,
        emergencyPhone,
        bloodGroup,
        homeAddress,
        morningRouteId: selectedRouteId || null,
        eveningRouteId: selectedRouteId || null,
      });
      alert('Student registered successfully with cryptographic QR transit pass.');
      setCreateModalOpen(false);
      setFullName('');
      setAdmissionNumber('');
      setEmergencyPhone('');
      loadStudents(1);
    } catch (err: any) {
      alert(err.message || 'Failed to register student');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <span>Student & Transit Enrollment</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Total {pagination.total || 0} registered students with assigned routes and cryptographic badges
          </p>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Register Student</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <form onSubmit={handleSearchSubmit} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by student name, admission number, or emergency phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Grades</option>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map((g) => (
              <option key={g} value={g}>Class {g}</option>
            ))}
          </select>

          <button
            type="submit"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
          >
            Search
          </button>
        </div>
      </form>

      {/* Students Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Student</th>
                <th className="px-6 py-3.5">Admission No</th>
                <th className="px-6 py-3.5">Class & Sec</th>
                <th className="px-6 py-3.5">Emergency Contact</th>
                <th className="px-6 py-3.5">Assigned Route & Stop</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">Loading student roster...</td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">No student records found.</td>
                </tr>
              ) : (
                students.map((st) => (
                  <tr key={st.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0">
                          {st.full_name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800">{st.full_name}</div>
                          <span className="text-[10px] text-slate-400 font-mono">Blood: {st.blood_group || 'O+'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono font-semibold text-slate-700">
                      {st.admission_number}
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-semibold text-[11px]">
                        {st.grade} - {st.section}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-1 text-slate-600 font-mono text-[11px]">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{st.emergency_phone}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {st.morning_route_name ? (
                        <div>
                          <div className="font-semibold text-slate-800 flex items-center space-x-1">
                            <Bus className="w-3 h-3 text-indigo-600" />
                            <span>{st.morning_route_code}</span>
                          </div>
                          <span className="text-[11px] text-slate-500">{st.morning_stop_name || 'Designated Stop'}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">Self / Walker</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setBadgeStudentId(st.id)}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition cursor-pointer"
                        title="Print or export student cryptographic QR transit badge"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>QR Pass</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
            </span>
            <div className="flex space-x-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => loadStudents(pagination.page - 1)}
                className="p-1 rounded border border-slate-300 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => loadStudents(pagination.page + 1)}
                className="p-1 rounded border border-slate-300 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* QR Badge Modal */}
      {badgeStudentId && (
        <StudentQrBadgeModal
          studentId={badgeStudentId}
          onClose={() => setBadgeStudentId(null)}
          onRevoked={() => loadStudents(pagination.page)}
        />
      )}

      {/* Register Student Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1">Register New Student</h3>
            <p className="text-xs text-slate-500 mb-4">
              Enrolls student into school database and automatically generates cryptographic transit credential
            </p>

            <form onSubmit={handleCreateStudent} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Student Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Aryan Malhotra"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Admission No *</label>
                  <input
                    type="text"
                    required
                    placeholder="DPS-2026-901"
                    value={admissionNumber}
                    onChange={(e) => setAdmissionNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Class / Grade *</label>
                  <select
                    value={studentGrade}
                    onChange={(e) => setStudentGrade(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  >
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Section *</label>
                  <input
                    type="text"
                    required
                    placeholder="A"
                    value={section}
                    onChange={(e) => setSection(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Phone *</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98100 00000"
                    value={emergencyPhone}
                    onChange={(e) => setEmergencyPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group</label>
                  <select
                    value={bloodGroup}
                    onChange={(e) => setBloodGroup(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  >
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assign Bus Route</label>
                <select
                  value={selectedRouteId}
                  onChange={(e) => setSelectedRouteId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                >
                  <option value="">-- No Bus Route Assigned --</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.route_code} - {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {submitting ? 'Registering...' : 'Enroll & Generate QR Pass'}
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
