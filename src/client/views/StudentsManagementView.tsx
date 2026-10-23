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
  UserPlus,
  ShieldCheck,
  UserCheck,
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
  const [editStudentModal, setEditStudentModal] = useState<any | null>(null);
  const [linkParentStudent, setLinkParentStudent] = useState<any | null>(null);
  const [viewGuardiansStudent, setViewGuardiansStudent] = useState<any | null>(null);
  const [editGuardian, setEditGuardian] = useState<any | null>(null);
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

  // Optional Parent Registration in Student Creation
  const [includeParent, setIncludeParent] = useState(false);
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [parentRelationship, setParentRelationship] = useState('FATHER');
  const [parentPassword, setParentPassword] = useState('');

  // Link Parent Form State (Dedicated Modal)
  const [linkGuardianName, setLinkGuardianName] = useState('');
  const [linkGuardianPhone, setLinkGuardianPhone] = useState('');
  const [linkGuardianEmail, setLinkGuardianEmail] = useState('');
  const [linkGuardianRel, setLinkGuardianRel] = useState('FATHER');
  const [linkGuardianPassword, setLinkGuardianPassword] = useState('');

  // Edit Student Form State
  const [editFullName, setEditFullName] = useState('');
  const [editGrade, setEditGrade] = useState('5');
  const [editSection, setEditSection] = useState('A');
  const [editEmergencyPhone, setEditEmergencyPhone] = useState('');
  const [editBloodGroup, setEditBloodGroup] = useState('B+');
  const [editHomeAddress, setEditHomeAddress] = useState('');
  const [editStatus, setEditStatus] = useState('ACTIVE');
  const [editRouteId, setEditRouteId] = useState('');

  // Edit Guardian Form State
  const [editGName, setEditGName] = useState('');
  const [editGPhone, setEditGPhone] = useState('');
  const [editGEmail, setEditGEmail] = useState('');
  const [editGRel, setEditGRel] = useState('FATHER');

  const [submitting, setSubmitting] = useState(false);

  // Pending Verifications State
  const [activeTab, setActiveTab] = useState<'ROSTER' | 'PENDING_VERIFICATIONS'>('ROSTER');
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);

  useEffect(() => {
    loadStudents(1);
    loadPendingRequests();
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
        parentName: includeParent ? parentName : undefined,
        parentPhone: includeParent ? parentPhone : undefined,
        parentEmail: includeParent ? parentEmail : undefined,
        parentRelationship: includeParent ? parentRelationship : undefined,
        parentPassword: includeParent ? parentPassword : undefined,
      });
      alert('Student registered successfully with cryptographic QR transit pass.');
      setCreateModalOpen(false);
      setFullName('');
      setAdmissionNumber('');
      setEmergencyPhone('');
      setParentName('');
      setParentPhone('');
      setParentEmail('');
      setParentPassword('');
      setIncludeParent(false);
      loadStudents(1);
    } catch (err: any) {
      alert(err.message || 'Failed to register student');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditStudent = (st: any) => {
    setEditStudentModal(st);
    setEditFullName(st.full_name || '');
    setEditGrade(st.grade || '5');
    setEditSection(st.section || 'A');
    setEditEmergencyPhone(st.emergency_phone || '');
    setEditBloodGroup(st.blood_group || 'B+');
    setEditHomeAddress(st.home_address || '');
    setEditStatus(st.status || 'ACTIVE');
    setEditRouteId(st.morning_route_id || '');
  };

  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editStudentModal) return;
    setSubmitting(true);
    try {
      await api.updateStudent(editStudentModal.id, {
        fullName: editFullName,
        grade: editGrade,
        section: editSection,
        emergencyPhone: editEmergencyPhone,
        bloodGroup: editBloodGroup,
        homeAddress: editHomeAddress,
        status: editStatus,
        morningRouteId: editRouteId || null,
        eveningRouteId: editRouteId || null,
      });
      alert('Student record updated successfully.');
      setEditStudentModal(null);
      loadStudents(pagination.page);
    } catch (err: any) {
      alert(err.message || 'Failed to update student');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLinkParent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkParentStudent) return;
    setSubmitting(true);
    try {
      const res = await api.addStudentGuardian(linkParentStudent.id, {
        fullName: linkGuardianName,
        phone: linkGuardianPhone,
        email: linkGuardianEmail,
        relationship: linkGuardianRel,
        password: linkGuardianPassword,
      });
      alert(res.message || 'Parent / Guardian linked successfully');
      setLinkParentStudent(null);
      setLinkGuardianName('');
      setLinkGuardianPhone('');
      setLinkGuardianEmail('');
      setLinkGuardianPassword('');
      loadStudents(pagination.page);
    } catch (err: any) {
      alert(err.message || 'Failed to link parent/guardian');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenViewGuardians = async (st: any) => {
    try {
      const details = await api.getStudent(st.id);
      setViewGuardiansStudent(details);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch student guardians');
    }
  };

  const handleOpenEditGuardian = (g: any) => {
    setEditGuardian(g);
    setEditGName(g.full_name || '');
    setEditGPhone(g.phone || '');
    setEditGEmail(g.email || '');
    setEditGRel(g.relationship || g.relationship_type || 'FATHER');
  };

  const handleUpdateGuardian = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editGuardian) return;
    setSubmitting(true);
    try {
      await api.updateGuardian(editGuardian.id, {
        fullName: editGName,
        phone: editGPhone,
        email: editGEmail,
        relationship: editGRel,
      });
      alert('Parent / Guardian details updated successfully.');
      setEditGuardian(null);
      if (viewGuardiansStudent) {
        handleOpenViewGuardians(viewGuardiansStudent.student);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update parent details');
    } finally {
      setSubmitting(false);
    }
  };

  const loadPendingRequests = async () => {
    setLoadingPending(true);
    try {
      const res = await api.getPendingVerifications();
      setPendingRequests(res.requests || []);
    } catch (err) {
      console.error('Failed to load pending verifications:', err);
    } finally {
      setLoadingPending(false);
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    if (!confirm('Approve this parent verification request and link them to the student?')) return;
    try {
      const res = await api.approveVerificationRequest(requestId);
      alert(res.message || 'Parent verification approved successfully.');
      loadPendingRequests();
      loadStudents(pagination.page);
    } catch (err: any) {
      alert(err.message || 'Failed to approve verification request.');
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    const reason = prompt('Enter reason for cancelling/rejecting this parent registration request:', 'Admission details could not be verified by school office');
    if (reason === null) return;
    try {
      const res = await api.cancelVerificationRequest(requestId, reason);
      alert(res.message || 'Verification request cancelled.');
      loadPendingRequests();
    } catch (err: any) {
      alert(err.message || 'Failed to cancel verification request.');
    }
  };

  const pendingCount = pendingRequests.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <span>Student & Parent Verification Management</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Total {pagination.total || 0} registered students and parent verification requests
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Tab Switcher */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center text-xs font-semibold">
            <button
              onClick={() => setActiveTab('ROSTER')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'ROSTER' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Student Roster
            </button>
            <button
              onClick={() => setActiveTab('PENDING_VERIFICATIONS')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center space-x-1.5 cursor-pointer ${
                activeTab === 'PENDING_VERIFICATIONS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Pending Parent Verifications</span>
              {pendingCount > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full animate-pulse">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>

          <button
            onClick={() => setCreateModalOpen(true)}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Register Student</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Student Roster */}
      {activeTab === 'ROSTER' ? (
        <>
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
                        <td className="px-6 py-4 text-right space-x-1.5">
                          <button
                            onClick={() => handleOpenEditStudent(st)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                            title="Edit Student Record"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleOpenViewGuardians(st)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer"
                            title="View & Edit Linked Parent Details"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Parents</span>
                          </button>

                          <button
                            onClick={() => setBadgeStudentId(st.id)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition cursor-pointer"
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
                    className="p-1 rounded border border-slate-300 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => loadStudents(pagination.page + 1)}
                    className="p-1 rounded border border-slate-300 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Tab 2: Pending Parent Verifications */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Parent School Verification Requests</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Review and approve parent registration requests to grant student tracking & attendance access
              </p>
            </div>
            <button
              onClick={loadPendingRequests}
              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">Parent / Guardian Name</th>
                  <th className="px-6 py-3.5">Contact Phone & Email</th>
                  <th className="px-6 py-3.5">Requested Student Adm No</th>
                  <th className="px-6 py-3.5">Matched Student Record</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Approve / Cancel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingPending ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">Loading parent verification requests...</td>
                  </tr>
                ) : pendingRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      No pending parent verification requests found.
                    </td>
                  </tr>
                ) : (
                  pendingRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-6 py-4 font-bold text-slate-800">
                        {req.parent_name}
                        <span className="block text-[10px] text-indigo-600 font-normal mt-0.5">
                          Relationship: {req.relationship_type || 'Parent'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-[11px] text-slate-600">
                        <div>{req.parent_phone || req.user_phone}</div>
                        <div className="text-slate-400 text-[10px]">{req.parent_email || req.user_email}</div>
                      </td>
                      <td className="px-6 py-4 font-mono font-bold text-indigo-700">
                        {req.student_admission_number}
                        {req.student_name && <span className="block text-[10px] text-slate-500 font-normal">({req.student_name})</span>}
                      </td>
                      <td className="px-6 py-4">
                        {req.matched_student_name ? (
                          <div className="text-emerald-700 font-semibold flex items-center space-x-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{req.matched_student_name} (Class {req.matched_student_grade}-{req.matched_student_section})</span>
                          </div>
                        ) : (
                          <span className="text-amber-600 italic text-[11px]">
                            ⚠️ No exact student record found for "{req.student_admission_number}"
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          req.status === 'PENDING' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                          req.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                          'bg-rose-100 text-rose-800 border border-rose-200'
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        {req.status === 'PENDING' ? (
                          <>
                            <button
                              onClick={() => handleApproveRequest(req.id)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleCancelRequest(req.id)}
                              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                            >
                              Cancel / Reject
                            </button>
                          </>
                        ) : (
                          <span className="text-slate-400 text-[11px] font-mono">
                            {req.reviewed_at ? new Date(req.reviewed_at).toLocaleDateString() : 'Reviewed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-100 my-8">
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

              {/* Parent Registration Toggle Section */}
              <div className="pt-2 border-t border-slate-200 mt-2">
                <label className="flex items-center space-x-2 text-xs font-semibold text-indigo-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeParent}
                    onChange={(e) => setIncludeParent(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                  />
                  <span>Register & Link Parent / Guardian Now</span>
                </label>

                {includeParent && (
                  <div className="mt-3 p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Full Name *</label>
                        <input
                          type="text"
                          required={includeParent}
                          placeholder="e.g. Rajesh Malhotra"
                          value={parentName}
                          onChange={(e) => setParentName(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Phone *</label>
                        <input
                          type="tel"
                          required={includeParent}
                          placeholder="+91 98100 00000"
                          value={parentPhone}
                          onChange={(e) => setParentPhone(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Relationship</label>
                        <select
                          value={parentRelationship}
                          onChange={(e) => setParentRelationship(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                        >
                          <option value="FATHER">Father</option>
                          <option value="MOTHER">Mother</option>
                          <option value="GUARDIAN">Guardian</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Email (For Portal)</label>
                        <input
                          type="email"
                          placeholder="parent@example.com"
                          value={parentEmail}
                          onChange={(e) => setParentEmail(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                        />
                      </div>
                    </div>

                    {parentEmail && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Portal Password</label>
                        <input
                          type="password"
                          placeholder="Set initial password (min 6 chars)"
                          value={parentPassword}
                          onChange={(e) => setParentPassword(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                        />
                        <span className="text-[10px] text-indigo-600 block mt-0.5">Allows parent to sign in to live transit tracking portal.</span>
                      </div>
                    )}
                  </div>
                )}
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

      {/* Edit Student Modal */}
      {editStudentModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1">Edit Student Record</h3>
            <p className="text-xs text-slate-500 mb-4">
              Editing record for admission <strong className="font-mono text-slate-700">{editStudentModal.admission_number}</strong>
            </p>

            <form onSubmit={handleUpdateStudent} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Student Name *</label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Class / Grade *</label>
                  <select
                    value={editGrade}
                    onChange={(e) => setEditGrade(e.target.value)}
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
                    value={editSection}
                    onChange={(e) => setEditSection(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group</label>
                  <select
                    value={editBloodGroup}
                    onChange={(e) => setEditBloodGroup(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  >
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Phone *</label>
                  <input
                    type="tel"
                    required
                    value={editEmergencyPhone}
                    onChange={(e) => setEditEmergencyPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ALUMNI">ALUMNI</option>
                    <option value="WITHDRAWN">WITHDRAWN</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assign Bus Route</label>
                <select
                  value={editRouteId}
                  onChange={(e) => setEditRouteId(e.target.value)}
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

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Home Address</label>
                <input
                  type="text"
                  value={editHomeAddress}
                  onChange={(e) => setEditHomeAddress(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                />
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditStudentModal(null)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View & Edit Student Guardians Modal */}
      {viewGuardiansStudent && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-800 text-base">Parents & Guardians</h3>
                <p className="text-xs text-slate-500">
                  Linked parents for <strong>{viewGuardiansStudent.student?.full_name}</strong>
                </p>
              </div>
              <button
                onClick={() => setViewGuardiansStudent(null)}
                className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3 max-h-80 overflow-y-auto">
              {viewGuardiansStudent.guardians?.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-4">No parent accounts linked to this student yet.</p>
              ) : (
                viewGuardiansStudent.guardians?.map((g: any) => (
                  <div key={g.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-xs text-slate-800 flex items-center space-x-2">
                        <span>{g.full_name}</span>
                        <span className="text-[10px] bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded">
                          {g.relationship_type || g.relationship || 'PARENT'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {g.phone} {g.email ? `• ${g.email}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpenEditGuardian(g)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                      title="Edit Parent Details"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => {
                  const student = viewGuardiansStudent.student;
                  setViewGuardiansStudent(null);
                  setLinkGuardianPhone(student?.emergency_phone || '');
                  setLinkParentStudent(student);
                }}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                + Link New Parent
              </button>
              <button
                type="button"
                onClick={() => setViewGuardiansStudent(null)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Guardian / Parent Details Modal */}
      {editGuardian && (
        <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <h3 className="font-bold text-slate-800 text-base mb-1">Edit Parent / Guardian</h3>
            <p className="text-xs text-slate-500 mb-4">Editing details for {editGuardian.full_name}</p>

            <form onSubmit={handleUpdateGuardian} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Full Name *</label>
                <input
                  type="text"
                  required
                  value={editGName}
                  onChange={(e) => setEditGName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={editGPhone}
                    onChange={(e) => setEditGPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Relationship</label>
                  <select
                    value={editGRel}
                    onChange={(e) => setEditGRel(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  >
                    <option value="FATHER">Father</option>
                    <option value="MOTHER">Mother</option>
                    <option value="GUARDIAN">Guardian</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={editGEmail}
                  onChange={(e) => setEditGEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                />
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {submitting ? 'Saving...' : 'Save Parent Details'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditGuardian(null)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Link Parent / Guardian Modal */}
      {linkParentStudent && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <div className="flex items-center space-x-2 text-indigo-600 mb-1">
              <UserCheck className="w-5 h-5" />
              <h3 className="font-bold text-slate-800 text-base">Link Parent / Guardian</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Register or link a parent account to <strong className="text-slate-800">{linkParentStudent.full_name}</strong> (Adm: {linkParentStudent.admission_number})
            </p>

            <form onSubmit={handleLinkParent} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sunita Sharma"
                  value={linkGuardianName}
                  onChange={(e) => setLinkGuardianName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98100 00000"
                    value={linkGuardianPhone}
                    onChange={(e) => setLinkGuardianPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Relationship *</label>
                  <select
                    value={linkGuardianRel}
                    onChange={(e) => setLinkGuardianRel(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  >
                    <option value="FATHER">Father</option>
                    <option value="MOTHER">Mother</option>
                    <option value="GUARDIAN">Guardian</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Email (For App Login)</label>
                <input
                  type="email"
                  placeholder="parent.login@example.com"
                  value={linkGuardianEmail}
                  onChange={(e) => setLinkGuardianEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                />
              </div>

              {linkGuardianEmail && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Portal Initial Password</label>
                  <input
                    type="password"
                    placeholder="Enter password for parent portal"
                    value={linkGuardianPassword}
                    onChange={(e) => setLinkGuardianPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Creates a PARENT account in the school system so they can track their child.</p>
                </div>
              )}

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {submitting ? 'Linking...' : 'Link Parent Account'}
                </button>
                <button
                  type="button"
                  onClick={() => setLinkParentStudent(null)}
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
