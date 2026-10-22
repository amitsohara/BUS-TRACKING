import React, { useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import {
  Building2,
  Search,
  Plus,
  RefreshCw,
  Mail,
  Phone,
  MapPin,
  Users,
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  Copy,
  Edit2,
  Trash2,
  Key,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  Info,
} from 'lucide-react';

interface SchoolItem {
  id: string;
  code: string;
  name: string;
  affiliation_number?: string;
  board?: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  contact_phone: string;
  contact_email: string;
  contact_person?: string;
  timezone?: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  created_at: string;
  updated_at: string;
  student_count: number;
  vehicle_count: number;
  driver_count: number;
  active_trips_count: number;
  active_admin_count: number;
  total_admin_count: number;
  pending_invitation_count: number;
  plan_name?: string;
  subscription_status?: string;
}

export const SchoolsManagementView: React.FC = () => {
  const [schools, setSchools] = useState<SchoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED' | 'TRIAL'>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalSchool, setEditModalSchool] = useState<SchoolItem | null>(null);
  const [detailsSchoolId, setDetailsSchoolId] = useState<string | null>(null);
  const [detailsData, setDetailsData] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Sub-modals inside Details
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [directAdminModalOpen, setDirectAdminModalOpen] = useState(false);
  const [lastGeneratedInvite, setLastGeneratedInvite] = useState<{ email: string; inviteUrl: string; token: string; deliveryStatus: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Forms State
  const [createForm, setCreateForm] = useState({
    name: '',
    code: '',
    affiliationNumber: '',
    board: 'CBSE',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    address: '',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110001',
    status: 'ACTIVE',
    initialAdminName: '',
    initialAdminEmail: '',
  });

  const [editForm, setEditForm] = useState({
    name: '',
    affiliationNumber: '',
    board: 'CBSE',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    timezone: 'Asia/Kolkata',
  });

  const [inviteForm, setInviteForm] = useState({
    fullName: '',
    email: '',
    role: 'SCHOOL_ADMIN',
  });

  const [directAdminForm, setDirectAdminForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
  });

  const [formSubmitting, setFormSubmitting] = useState(false);

  useEffect(() => {
    loadSchools();
  }, [page, statusFilter]);

  const loadSchools = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSchools({
        search,
        status: statusFilter,
        page,
        limit: 10,
      });
      if (res.success) {
        setSchools(res.schools || []);
        if (res.pagination) {
          setTotalPages(res.pagination.totalPages);
          setTotalCount(res.pagination.totalCount);
        } else {
          setTotalPages(1);
          setTotalCount(res.schools?.length || 0);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load school directory');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadSchools();
  };

  const handleOpenDetails = async (schoolId: string) => {
    setDetailsSchoolId(schoolId);
    setDetailsLoading(true);
    setLastGeneratedInvite(null);
    try {
      const res = await api.getSchoolDetails(schoolId);
      if (res.success) {
        setDetailsData(res);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch school details');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleToggleSchoolStatus = async (school: SchoolItem) => {
    const nextStatus = school.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const confirmPrompt = window.confirm(
      `Are you sure you want to change status of "${school.name}" (${school.code}) to ${nextStatus}?`
    );
    if (!confirmPrompt) return;

    try {
      const res = await api.updateSchoolStatus(school.id, nextStatus as any);
      if (res.success) {
        setSuccessMessage(`School status updated to ${nextStatus}`);
        loadSchools();
        if (detailsSchoolId === school.id) {
          handleOpenDetails(school.id);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update school status');
    }
  };

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setError(null);
    try {
      const res = await api.createSchool(createForm);
      if (res.success) {
        setCreateModalOpen(false);
        setSuccessMessage(`School "${createForm.name}" created successfully.`);
        if (res.initialInvitation) {
          setLastGeneratedInvite({
            email: res.initialInvitation.email,
            token: res.initialInvitation.token,
            inviteUrl: `${window.location.origin}/?token=${res.initialInvitation.token}`,
            deliveryStatus: res.initialInvitation.deliveryStatus,
          });
        }
        // Reset form
        setCreateForm({
          name: '',
          code: '',
          affiliationNumber: '',
          board: 'CBSE',
          contactPerson: '',
          contactPhone: '',
          contactEmail: '',
          address: '',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110001',
          status: 'ACTIVE',
          initialAdminName: '',
          initialAdminEmail: '',
        });
        loadSchools();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create school');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleOpenEdit = (school: SchoolItem) => {
    setEditModalSchool(school);
    setEditForm({
      name: school.name,
      affiliationNumber: school.affiliation_number || '',
      board: school.board || 'CBSE',
      contactPerson: school.contact_person || '',
      contactPhone: school.contact_phone || '',
      contactEmail: school.contact_email || '',
      address: school.address || '',
      city: school.city || '',
      state: school.state || '',
      pincode: school.pincode || '',
      timezone: school.timezone || 'Asia/Kolkata',
    });
  };

  const handleUpdateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalSchool) return;
    setFormSubmitting(true);
    setError(null);
    try {
      const res = await api.updateSchool(editModalSchool.id, editForm);
      if (res.success) {
        setEditModalSchool(null);
        setSuccessMessage(`School updated successfully.`);
        loadSchools();
        if (detailsSchoolId === editModalSchool.id) {
          handleOpenDetails(editModalSchool.id);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update school');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleInviteAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailsSchoolId) return;
    setFormSubmitting(true);
    setError(null);
    try {
      const res = await api.inviteSchoolAdmin(detailsSchoolId, inviteForm);
      if (res.success) {
        setInviteModalOpen(false);
        const fullInviteUrl = `${window.location.origin}/?token=${res.invitation.token}`;
        setLastGeneratedInvite({
          email: res.invitation.email,
          token: res.invitation.token,
          inviteUrl: fullInviteUrl,
          deliveryStatus: res.invitation.deliveryStatus,
        });
        setInviteForm({ fullName: '', email: '', role: 'SCHOOL_ADMIN' });
        handleOpenDetails(detailsSchoolId);
        loadSchools();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate invitation');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDirectCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailsSchoolId) return;
    setFormSubmitting(true);
    setError(null);
    try {
      const res = await api.createSchoolAdmin(detailsSchoolId, directAdminForm);
      if (res.success) {
        setDirectAdminModalOpen(false);
        setSuccessMessage(res.message || 'Administrator account created.');
        setDirectAdminForm({ fullName: '', email: '', phone: '', password: '' });
        handleOpenDetails(detailsSchoolId);
        loadSchools();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create administrator');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggleAdminStatus = async (userId: string, currentStatus: string) => {
    if (!detailsSchoolId) return;
    const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await api.updateAdminStatus(detailsSchoolId, userId, nextStatus as any);
      if (res.success) {
        setSuccessMessage(`Administrator membership status set to ${nextStatus}.`);
        handleOpenDetails(detailsSchoolId);
        loadSchools();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update administrator status');
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!detailsSchoolId) return;
    try {
      const res = await api.revokeInvitation(detailsSchoolId, invitationId);
      if (res.success) {
        setSuccessMessage('Invitation revoked.');
        handleOpenDetails(detailsSchoolId);
        loadSchools();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to revoke invitation');
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    if (!detailsSchoolId) return;
    try {
      const res = await api.resendInvitation(detailsSchoolId, invitationId);
      if (res.success) {
        const fullInviteUrl = `${window.location.origin}/?token=${res.invitation.token}`;
        setLastGeneratedInvite({
          email: res.invitation.email,
          token: res.invitation.token,
          inviteUrl: fullInviteUrl,
          deliveryStatus: 'DISABLED_NO_GATEWAY',
        });
        setSuccessMessage(`Fresh activation token generated for ${res.invitation.email}.`);
        handleOpenDetails(detailsSchoolId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend invitation');
    }
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center space-x-2 text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1">
            <Building2 className="w-4 h-4" />
            <span>Platform Administration</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            School Management & Governance
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Register school tenants, provision School Administrator accounts, govern operational status, and monitor fleet telemetry.
          </p>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <button
            onClick={() => loadSchools()}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer"
            title="Refresh schools"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { setCreateModalOpen(true); setError(null); }}
            className="flex items-center space-x-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Register School</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-3 text-rose-800 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
          <div className="flex-1">
            <span className="font-semibold block">Error Encountered</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-3 text-emerald-800 text-xs">
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          <div className="flex-1">
            <span className="font-semibold block">Success</span>
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-500 hover:text-emerald-700 cursor-pointer text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* Generated Invite Modal Banner */}
      {lastGeneratedInvite && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 font-bold">
              <Key className="w-4 h-4 text-amber-600" />
              <span>School Admin Activation Link Ready</span>
            </div>
            <button
              onClick={() => setLastGeneratedInvite(null)}
              className="text-amber-700 hover:text-amber-900 font-bold cursor-pointer"
            >
              Close
            </button>
          </div>
          <p className="text-[11px] text-amber-800">
            {lastGeneratedInvite.deliveryStatus === 'DISABLED_NO_GATEWAY' ? (
              <span>
                <strong>Truthful Delivery:</strong> No external SMTP/SMS gateway is provisioned in the current environment. Please copy this secure single-use invitation link and send it directly to <strong>{lastGeneratedInvite.email}</strong>.
              </span>
            ) : (
              <span>Invitation dispatched to <strong>{lastGeneratedInvite.email}</strong>. You may also provide the link directly below:</span>
            )}
          </p>
          <div className="flex items-center space-x-2 bg-white p-2 rounded-lg border border-amber-200">
            <input
              type="text"
              readOnly
              value={lastGeneratedInvite.inviteUrl}
              className="flex-1 text-[11px] font-mono bg-transparent text-slate-800 outline-hidden select-all"
            />
            <button
              onClick={() => handleCopyLink(lastGeneratedInvite.inviteUrl)}
              className="flex items-center space-x-1 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold text-[11px] cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Search and Filters Strip */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search school name, code, city, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-20 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-semibold rounded cursor-pointer"
          >
            Search
          </button>
        </form>

        {/* Status Filters - Segmented Control */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
          {(['ALL', 'ACTIVE', 'SUSPENDED', 'TRIAL'] as const).map((st) => (
            <button
              key={st}
              onClick={() => { setStatusFilter(st); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition cursor-pointer ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st === 'ALL' ? 'All Schools' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Schools Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-xs">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            Loading school tenants...
          </div>
        ) : schools.length === 0 ? (
          <div className="py-16 text-center text-slate-500 space-y-2">
            <Building2 className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">No schools found</p>
            <p className="text-xs text-slate-400">
              {search || statusFilter !== 'ALL'
                ? 'Try adjusting your search criteria or status filter.'
                : 'Click "Register School" to onboard your first school tenant.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-3.5 px-4">School & Code</th>
                  <th className="py-3.5 px-4">Location</th>
                  <th className="py-3.5 px-4">Official Contact</th>
                  <th className="py-3.5 px-4 text-center">Fleet & Students</th>
                  <th className="py-3.5 px-4 text-center">Admin Accounts</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schools.map((school) => (
                  <tr key={school.id} className="hover:bg-slate-50/80 transition">
                    {/* School Name & Code */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{school.name}</div>
                      <div className="flex items-center space-x-2 text-[11px] text-slate-500 mt-0.5">
                        <span className="font-mono font-semibold text-indigo-600">{school.code}</span>
                        <span aria-hidden="true">·</span>
                        <span>{school.board || 'CBSE'}</span>
                        {school.affiliation_number && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Affil: {school.affiliation_number}</span>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Location */}
                    <td className="py-3.5 px-4 text-slate-600">
                      <div className="flex items-center space-x-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[180px]">{school.city}, {school.state}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 pl-5">{school.pincode}</div>
                    </td>

                    {/* Contact */}
                    <td className="py-3.5 px-4 text-slate-600">
                      <div className="flex items-center space-x-1.5">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[180px]">{school.contact_email}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 text-[11px] text-slate-500 mt-0.5">
                        <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>{school.contact_phone}</span>
                        {school.contact_person && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-[100px]">{school.contact_person}</span>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Fleet & Students */}
                    <td className="py-3.5 px-4 text-center">
                      <div className="font-mono tabular-nums font-semibold text-slate-800">
                        {school.student_count} <span className="font-normal text-slate-400">students</span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                        {school.vehicle_count} buses · {school.driver_count} drivers
                      </div>
                    </td>

                    {/* Admin Accounts */}
                    <td className="py-3.5 px-4 text-center">
                      <div className="font-mono tabular-nums font-semibold text-slate-800">
                        {school.active_admin_count} <span className="font-normal text-slate-400">active</span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                        {school.pending_invitation_count > 0 ? (
                          <span className="text-amber-600 font-semibold">{school.pending_invitation_count} pending invite</span>
                        ) : (
                          <span>0 pending</span>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 text-center">
                      <div className="inline-flex items-center space-x-1.5 text-xs font-semibold">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            school.status === 'ACTIVE'
                              ? 'bg-emerald-500'
                              : school.status === 'SUSPENDED'
                              ? 'bg-rose-500'
                              : 'bg-amber-500'
                          }`}
                        />
                        <span
                          className={
                            school.status === 'ACTIVE'
                              ? 'text-emerald-700'
                              : school.status === 'SUSPENDED'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                          }
                        >
                          {school.status}
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right space-x-2 shrink-0">
                      <button
                        onClick={() => handleOpenDetails(school.id)}
                        className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs transition cursor-pointer"
                      >
                        Manage Admins
                      </button>
                      <button
                        onClick={() => handleOpenEdit(school)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition cursor-pointer"
                        title="Edit School"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleSchoolStatus(school)}
                        className={`px-2 py-1 rounded text-[11px] font-semibold transition cursor-pointer ${
                          school.status === 'ACTIVE'
                            ? 'text-rose-600 hover:bg-rose-50'
                            : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                        title={school.status === 'ACTIVE' ? 'Suspend School Access' : 'Activate School Access'}
                      >
                        {school.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="py-3 px-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            Showing <span className="font-mono tabular-nums font-semibold text-slate-700">{schools.length}</span> of{' '}
            <span className="font-mono tabular-nums font-semibold text-slate-700">{totalCount}</span> schools
          </div>
          <div className="flex items-center space-x-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white text-slate-700 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono tabular-nums">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white text-slate-700 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* CREATE SCHOOL MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Register New School Tenant</h3>
                  <p className="text-xs text-slate-500">Create school record, configure initial boundaries and invite administrator.</p>
                </div>
              </div>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSchool} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">School Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Modern School Barakhamba"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Unique School Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MSBK (uppercase)"
                    value={createForm.code}
                    onChange={(e) => setCreateForm({ ...createForm, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono uppercase text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Affiliation / Board</label>
                  <div className="flex gap-2">
                    <select
                      value={createForm.board}
                      onChange={(e) => setCreateForm({ ...createForm, board: e.target.value })}
                      className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="CBSE">CBSE</option>
                      <option value="ICSE">ICSE</option>
                      <option value="State Board">State Board</option>
                      <option value="IB">IB</option>
                      <option value="Cambridge">Cambridge</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Affil Number"
                      value={createForm.affiliationNumber}
                      onChange={(e) => setCreateForm({ ...createForm, affiliationNumber: e.target.value })}
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Person</label>
                  <input
                    type="text"
                    placeholder="e.g. Principal / Transport Head"
                    value={createForm.contactPerson}
                    onChange={(e) => setCreateForm({ ...createForm, contactPerson: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Official Contact Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="admin@school.edu.in"
                    value={createForm.contactEmail}
                    onChange={(e) => setCreateForm({ ...createForm, contactEmail: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Phone *</label>
                  <input
                    type="text"
                    required
                    placeholder="+91 98111 22334"
                    value={createForm.contactPhone}
                    onChange={(e) => setCreateForm({ ...createForm, contactPhone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Street Address *</label>
                <input
                  type="text"
                  required
                  placeholder="Campus Address, Road, Sector"
                  value={createForm.address}
                  onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">City *</label>
                  <input
                    type="text"
                    required
                    value={createForm.city}
                    onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">State *</label>
                  <input
                    type="text"
                    required
                    value={createForm.state}
                    onChange={(e) => setCreateForm({ ...createForm, state: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pincode *</label>
                  <input
                    type="text"
                    required
                    value={createForm.pincode}
                    onChange={(e) => setCreateForm({ ...createForm, pincode: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Initial School Admin Invitation Section */}
              <div className="pt-3 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-800 block mb-1">
                  Initial School Administrator (Optional Invitation)
                </span>
                <p className="text-[11px] text-slate-500 mb-3">
                  If provided, an activation invitation token will be generated immediately for this administrator.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Admin Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Dr. Rajesh Sharma"
                      value={createForm.initialAdminName}
                      onChange={(e) => setCreateForm({ ...createForm, initialAdminName: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Admin Email Address</label>
                    <input
                      type="email"
                      placeholder="admin.modern@school.in"
                      value={createForm.initialAdminEmail}
                      onChange={(e) => setCreateForm({ ...createForm, initialAdminEmail: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50 cursor-pointer"
                >
                  {formSubmitting ? 'Registering School...' : 'Register School'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT SCHOOL MODAL */}
      {editModalSchool && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Edit School: {editModalSchool.name}</h3>
              <button onClick={() => setEditModalSchool(null)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">✕</button>
            </div>
            <form onSubmit={handleUpdateSchool} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">School Name</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Email</label>
                  <input
                    type="email"
                    required
                    value={editForm.contactEmail}
                    onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Phone</label>
                  <input
                    type="text"
                    required
                    value={editForm.contactPhone}
                    onChange={(e) => setEditForm({ ...editForm, contactPhone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Person</label>
                <input
                  type="text"
                  value={editForm.contactPerson}
                  onChange={(e) => setEditForm({ ...editForm, contactPerson: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  required
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
                  <input
                    type="text"
                    required
                    value={editForm.city}
                    onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">State</label>
                  <input
                    type="text"
                    required
                    value={editForm.state}
                    onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pincode</label>
                  <input
                    type="text"
                    required
                    value={editForm.pincode}
                    onChange={(e) => setEditForm({ ...editForm, pincode: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditModalSchool(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SCHOOL DETAILS & ADMIN ACCOUNTS DRAWER / MODAL */}
      {detailsSchoolId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 my-8 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold font-mono text-sm">
                  {detailsData?.school?.code || 'SCH'}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {detailsData?.school?.name || 'School Details'}
                  </h3>
                  <div className="flex items-center space-x-2 text-xs text-slate-500">
                    <span>Code: {detailsData?.school?.code}</span>
                    <span aria-hidden="true">·</span>
                    <span>City: {detailsData?.school?.city}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-emerald-700">{detailsData?.school?.status}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setDetailsSchoolId(null)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="overflow-y-auto flex-1 py-4 space-y-6">
              {detailsLoading ? (
                <div className="py-12 text-center text-xs text-slate-400">Loading school details & admins...</div>
              ) : detailsData ? (
                <>
                  {/* Overview Stats Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                    <div>
                      <div className="text-slate-500 text-[11px]">Enrolled Students</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                        {detailsData.stats?.totalStudents || 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">Active Fleet Buses</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                        {detailsData.stats?.totalVehicles || 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">Verified Drivers</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                        {detailsData.stats?.totalDrivers || 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[11px]">Live In-Progress Trips</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-indigo-600">
                        {detailsData.stats?.activeTrips || 0}
                      </div>
                    </div>
                  </div>

                  {/* School Administrators Section */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Associated School Administrators</h4>
                        <p className="text-xs text-slate-500">Users authorized to govern transport, staff, and student passes for this school.</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => { setInviteModalOpen(true); setError(null); }}
                          className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Invite Admin</span>
                        </button>
                        <button
                          onClick={() => { setDirectAdminModalOpen(true); setError(null); }}
                          className="flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Direct Create</span>
                        </button>
                      </div>
                    </div>

                    {/* Active Admins List */}
                    {detailsData.administrators?.length === 0 ? (
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center text-xs text-slate-500">
                        No administrators currently assigned to this school. Click "Invite Admin" to create one.
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 uppercase border-b border-slate-200">
                            <tr>
                              <th className="py-2.5 px-3">Administrator</th>
                              <th className="py-2.5 px-3">Contact</th>
                              <th className="py-2.5 px-3">Role</th>
                              <th className="py-2.5 px-3 text-center">Status</th>
                              <th className="py-2.5 px-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {detailsData.administrators?.map((adm: any) => (
                              <tr key={adm.user_id} className="hover:bg-slate-50/60">
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-slate-900">{adm.full_name}</div>
                                  <div className="text-[11px] text-slate-400 font-mono">{adm.email}</div>
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 text-[11px]">
                                  {adm.phone || '—'}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                                  {adm.role}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <span
                                    className={`text-[11px] font-semibold ${
                                      adm.membership_status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-400'
                                    }`}
                                  >
                                    {adm.membership_status}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    onClick={() => handleToggleAdminStatus(adm.user_id, adm.membership_status)}
                                    className={`px-2 py-1 rounded text-[11px] font-semibold transition cursor-pointer ${
                                      adm.membership_status === 'ACTIVE'
                                        ? 'text-rose-600 hover:bg-rose-50'
                                        : 'text-emerald-600 hover:bg-emerald-50'
                                    }`}
                                  >
                                    {adm.membership_status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Pending Invitations Section */}
                    {detailsData.invitations?.length > 0 && (
                      <div className="mt-4">
                        <h5 className="text-xs font-bold text-slate-800 mb-2">Pending Activation Invitations</h5>
                        <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                          <table className="w-full text-left">
                            <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 uppercase border-b border-slate-200">
                              <tr>
                                <th className="py-2 px-3">Invitee</th>
                                <th className="py-2 px-3">Token Hint</th>
                                <th className="py-2 px-3">Expires</th>
                                <th className="py-2 px-3">Delivery Status</th>
                                <th className="py-2 px-3 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {detailsData.invitations.map((inv: any) => (
                                <tr key={inv.id} className="hover:bg-slate-50/60">
                                  <td className="py-2 px-3">
                                    <div className="font-semibold text-slate-900">{inv.full_name}</div>
                                    <div className="text-[11px] text-slate-400 font-mono">{inv.email}</div>
                                  </td>
                                  <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                                    {inv.token_hint}
                                  </td>
                                  <td className="py-2 px-3 text-[11px] text-slate-500">
                                    {new Date(inv.expires_at).toLocaleDateString()}
                                  </td>
                                  <td className="py-2 px-3 text-[11px]">
                                    <span
                                      className={
                                        inv.delivery_status === 'DELIVERED_EMAIL'
                                          ? 'text-emerald-700'
                                          : 'text-amber-700 font-medium'
                                      }
                                    >
                                      {inv.delivery_status}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-right space-x-2">
                                    {inv.status === 'PENDING' && (
                                      <>
                                        <button
                                          onClick={() => handleResendInvitation(inv.id)}
                                          className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold cursor-pointer"
                                        >
                                          Refresh & Copy
                                        </button>
                                        <button
                                          onClick={() => handleRevokeInvitation(inv.id)}
                                          className="text-rose-600 hover:text-rose-800 text-[11px] font-semibold cursor-pointer"
                                        >
                                          Revoke
                                        </button>
                                      </>
                                    )}
                                    {inv.status !== 'PENDING' && (
                                      <span className="text-[11px] text-slate-400">{inv.status}</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Audit History */}
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 mb-2">Recent School Audit Trail</h4>
                    <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 max-h-48 overflow-y-auto space-y-2 text-xs">
                      {detailsData.auditHistory?.length === 0 ? (
                        <div className="text-slate-400 text-center py-4">No audit records found for this school.</div>
                      ) : (
                        detailsData.auditHistory.map((log: any) => (
                          <div key={log.id} className="flex items-center justify-between border-b border-slate-200/60 pb-1.5 text-[11px]">
                            <div className="flex items-center space-x-2">
                              <span className="font-mono font-bold text-slate-700">{log.action}</span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span className="text-slate-500">{log.entity_type} ({log.entity_id || '—'})</span>
                            </div>
                            <div className="text-slate-400 font-mono text-[10px]">
                              {new Date(log.created_at).toLocaleString()}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-100 flex justify-end shrink-0">
              <button
                onClick={() => setDetailsSchoolId(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INVITE SCHOOL ADMIN MODAL */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Invite School Administrator</h3>
              <button onClick={() => setInviteModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">✕</button>
            </div>
            <form onSubmit={handleInviteAdmin} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Chandra"
                  value={inviteForm.fullName}
                  onChange={(e) => setInviteForm({ ...inviteForm, fullName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="ramesh.admin@school.edu.in"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Role</label>
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden"
                >
                  <option value="SCHOOL_ADMIN">School Administrator (Full Tenant Control)</option>
                  <option value="TRANSPORT_MANAGER">Transport Manager (Fleet & Dispatch Only)</option>
                </select>
              </div>
              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50 cursor-pointer"
                >
                  {formSubmitting ? 'Generating Invite...' : 'Generate Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIRECT CREATE ADMIN MODAL */}
      {directAdminModalOpen && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Directly Create Administrator Account</h3>
              <button onClick={() => setDirectAdminModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">✕</button>
            </div>
            <form onSubmit={handleDirectCreateAdmin} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Priya Sharma"
                  value={directAdminForm.fullName}
                  onChange={(e) => setDirectAdminForm({ ...directAdminForm, fullName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="priya.admin@school.edu.in"
                  value={directAdminForm.email}
                  onChange={(e) => setDirectAdminForm({ ...directAdminForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  placeholder="+91 98765 43210"
                  value={directAdminForm.phone}
                  onChange={(e) => setDirectAdminForm({ ...directAdminForm, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Password * (min 8 chars)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={directAdminForm.password}
                  onChange={(e) => setDirectAdminForm({ ...directAdminForm, password: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-hidden"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDirectAdminModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50 cursor-pointer"
                >
                  {formSubmitting ? 'Creating Account...' : 'Create Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
