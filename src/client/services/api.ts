// SurakshaVahan REST API Service Client

const API_BASE = '/api/v1';

export interface UserSession {
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    phone?: string;
    systemRole: string;
  };
  activeSchool: {
    schoolId: string;
    schoolName: string;
    schoolCode: string;
    role: string;
  } | null;
  memberships: Array<{
    membership_id: string;
    school_id: string;
    role: string;
    school_name: string;
    school_code: string;
  }>;
}

class ApiService {
  private token: string | null = null;
  private schoolId: string | null = null;

  constructor() {
    this.token = localStorage.getItem('sv_auth_token');
    this.schoolId = localStorage.getItem('sv_school_id');
  }

  setSession(session: UserSession) {
    this.token = session.token;
    localStorage.setItem('sv_auth_token', session.token);
    if (session.activeSchool) {
      this.schoolId = session.activeSchool.schoolId;
      localStorage.setItem('sv_school_id', session.activeSchool.schoolId);
    }
  }

  clearSession() {
    this.token = null;
    this.schoolId = null;
    localStorage.removeItem('sv_auth_token');
    localStorage.removeItem('sv_school_id');
  }

  getToken(): string | null {
    return this.token;
  }

  getSchoolId(): string | null {
    return this.schoolId;
  }

  private async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.schoolId) {
      headers['x-school-id'] = this.schoolId;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    // Handle non-JSON or download responses (like CSV)
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/csv')) {
      return (await res.blob()) as unknown as T;
    }

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch (_err) {
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}. Please check backend logs.`);
      }
      throw new Error(`Invalid response format from server (HTTP ${res.status}).`);
    }

    if (!res.ok || data.success === false) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }

    return data;
  }

  // Auth
  getAuthConfig() {
    return this.request<{ success: boolean; isProduction: boolean; demoModeEnabled: boolean }>('/auth/config');
  }

  login(email: string, password: string) {
    return this.request<UserSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  registerSchool(payload: any) {
    return this.request<any>('/auth/register-school', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  switchContext(schoolId: string) {
    return this.request<{ success: boolean; token: string; activeSchool: any }>('/auth/switch-context', {
      method: 'POST',
      body: JSON.stringify({ schoolId }),
    });
  }

  getMe() {
    return this.request<any>('/auth/me');
  }

  logout() {
    return this.request('/auth/logout', { method: 'POST' });
  }

  deleteAccount() {
    return this.request<{ success: boolean; message: string }>('/auth/me', { method: 'DELETE' });
  }

  // Schools & Stats
  getSchools(params: { search?: string; status?: string; page?: number; limit?: number } = {}) {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request<{ success: boolean; schools: any[]; totalCount?: number; pagination?: any }>(`/schools${qs ? `?${qs}` : ''}`);
  }

  getSchoolDetails(id: string) {
    return this.request<{
      success: boolean;
      school: any;
      settings: any;
      subscription: any;
      administrators: any[];
      invitations: any[];
      stats: any;
      auditHistory: any[];
    }>(`/schools/${id}`);
  }

  createSchool(payload: any) {
    return this.request<{ success: boolean; message: string; school: any; initialInvitation?: any }>('/schools', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateSchool(id: string, payload: any) {
    return this.request<{ success: boolean; message: string; school: any }>(`/schools/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  updateSchoolStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL') {
    return this.request<{ success: boolean; message: string; status: string }>(`/schools/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  createSchoolAdmin(schoolId: string, payload: { email: string; fullName: string; phone?: string; password?: string }) {
    return this.request<{ success: boolean; message: string; user: any }>(`/schools/${schoolId}/admins`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  inviteSchoolAdmin(schoolId: string, payload: { email: string; fullName: string; role?: string }) {
    return this.request<{ success: boolean; message: string; invitation: any }>(`/schools/${schoolId}/admins/invite`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateAdminStatus(schoolId: string, userId: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.request<{ success: boolean; message: string; membershipStatus: string }>(`/schools/${schoolId}/admins/${userId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  }

  revokeInvitation(schoolId: string, invitationId: string) {
    return this.request<{ success: boolean; message: string }>(`/schools/${schoolId}/invitations/${invitationId}/revoke`, {
      method: 'POST',
    });
  }

  resendInvitation(schoolId: string, invitationId: string) {
    return this.request<{ success: boolean; message: string; invitation: any }>(`/schools/${schoolId}/invitations/${invitationId}/resend`, {
      method: 'POST',
    });
  }

  getInvitationInfo(token: string) {
    return this.request<{ success: boolean; invitation: any }>(`/auth/invitation-info?token=${encodeURIComponent(token)}`);
  }

  acceptInvitation(payload: { token: string; password: string; fullName?: string; phone?: string }) {
    return this.request<any>('/auth/accept-invitation', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getCurrentSchool() {
    return this.request<{ success: boolean; school: any; settings: any; subscription: any; stats: any }>('/schools/current');
  }

  updateSettings(settings: any) {
    return this.request('/schools/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Students
  getStudents(params: { search?: string; grade?: string; page?: number; limit?: number } = {}) {
    const query = new URLSearchParams(params as any).toString();
    return this.request<{ success: boolean; students: any[]; pagination: any }>(`/students?${query}`);
  }

  getStudent(id: string) {
    return this.request<{ success: boolean; student: any; guardians: any[]; qrCredential: any; recentAttendance: any[] }>(`/students/${id}`);
  }

  createStudent(payload: any) {
    return this.request('/students', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateStudent(id: string, payload: any) {
    return this.request(`/students/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  getStudentQrBadge(id: string) {
    return this.request<{ success: boolean; student: any; qrDataUrl: string; qrPayload: string; credential: any }>(`/students/${id}/qr-badge`);
  }

  revokeStudentQr(id: string, reason: string) {
    return this.request(`/students/${id}/revoke-qr`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Vehicles
  getVehicles() {
    return this.request<{ success: boolean; vehicles: any[] }>('/vehicles');
  }

  createVehicle(payload: any) {
    return this.request('/vehicles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateVehicle(id: string, payload: any) {
    return this.request(`/vehicles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  // Drivers
  getDrivers() {
    return this.request<{ success: boolean; drivers: any[] }>('/drivers');
  }

  createDriver(payload: any) {
    return this.request('/drivers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateDriver(id: string, payload: any) {
    return this.request(`/drivers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  // Routes
  getRoutes() {
    return this.request<{ success: boolean; routes: any[] }>('/routes');
  }

  getRoute(id: string) {
    return this.request<{ success: boolean; route: any; stops: any[]; students: any[] }>(`/routes/${id}`);
  }

  createRoute(payload: any) {
    return this.request('/routes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  addRouteStop(routeId: string, payload: any) {
    return this.request(`/routes/${routeId}/stops`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Trips
  getTrips(params: { status?: string; date?: string } = {}) {
    const query = new URLSearchParams(params as any).toString();
    return this.request<{ success: boolean; trips: any[] }>(`/trips?${query}`);
  }

  getTrip(id: string) {
    return this.request<{ success: boolean; trip: any; stops: any[]; expectedStudents: any[]; latestLocation: any }>(`/trips/${id}`);
  }

  scheduleTrip(payload: any) {
    return this.request('/trips', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  startTrip(id: string) {
    return this.request(`/trips/${id}/start`, { method: 'POST' });
  }

  completeTrip(id: string, payload: { physicalCheckConfirmed: boolean; reconciliationNotes?: string }) {
    return this.request(`/trips/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  cancelTrip(id: string, reason: string) {
    return this.request(`/trips/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Telemetry & GPS Ingestion
  ingestGpsLocation(tripId: string, payload: {
    latitude: number;
    longitude: number;
    speedKmh?: number;
    heading?: number;
    accuracyMeters?: number;
    recordedAt?: string;
  }) {
    return this.request(`/trips/${tripId}/locations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getTripLatestLocation(tripId: string) {
    return this.request<{ success: boolean; hasLocation: boolean; location?: any; freshness?: any; tripStatus: string }>(`/trips/${tripId}/locations/latest`);
  }

  getTripLocationTrail(tripId: string) {
    return this.request<{ success: boolean; count: number; coordinates: any[] }>(`/trips/${tripId}/locations/history`);
  }

  // Attendance Scanning
  scanAttendanceQr(tripId: string, payload: {
    qrPayload: string;
    stopId?: string;
    latitude?: number;
    longitude?: number;
    preferredEventType?: 'BOARDING' | 'DROP_OFF';
  }) {
    return this.request(`/trips/${tripId}/attendance/scan`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  manualAttendanceOverride(tripId: string, payload: {
    studentId: string;
    eventType: 'BOARDING' | 'DROP_OFF';
    manualReason: string;
    stopId?: string;
    latitude?: number;
    longitude?: number;
  }) {
    return this.request(`/trips/${tripId}/attendance/manual`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Parent Portal
  getParentChildren() {
    return this.request<{ success: boolean; children: any[] }>('/parents/children');
  }

  getParentNotifications() {
    return this.request<{ success: boolean; notifications: any[] }>('/parents/notifications');
  }

  markNotificationRead(notificationId?: string) {
    return this.request('/parents/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({ notificationId }),
    });
  }

  // Reports
  async downloadAttendanceCsv(fromDate?: string, toDate?: string) {
    const params = new URLSearchParams();
    if (fromDate) params.append('fromDate', fromDate);
    if (toDate) params.append('toDate', toDate);
    const blob = await this.request<Blob>(`/reports/attendance-csv?${params.toString()}`);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-report-${Date.now()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  async downloadTripsCsv() {
    const blob = await this.request<Blob>('/reports/trips-csv');
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trips-fleet-report-${Date.now()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  getSafetyExceptions() {
    return this.request<{ success: boolean; manualOverrides: any[]; speedAlerts: any[]; allEvents?: any[] }>('/reports/safety-exceptions');
  }

  // Audit Logs
  getAuditLogs(params: { action?: string; entityType?: string; page?: number; limit?: number } = {}) {
    const query = new URLSearchParams(params as any).toString();
    return this.request<{ success: boolean; logs: any[]; pagination: any }>(`/audit-logs?${query}`);
  }

  // System Health
  getHealth() {
    return this.request<any>('/health');
  }

  // OpenAPI Spec
  getOpenApiSpec() {
    return this.request<any>('/openapi.json');
  }
}

export const api = new ApiService();
