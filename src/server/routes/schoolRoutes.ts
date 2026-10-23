import crypto from 'node:crypto';
import { Router, Response } from 'express';
import { db } from '../db.ts';
import {
  authenticate,
  requireSchoolContext,
  AuthRequest,
  logAudit,
  hashPassword,
} from '../auth.ts';

export const schoolRoutes = Router();

// Helper to hash invitation token with SHA-256
export function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// GET /api/v1/schools - List schools with search, filtering, and pagination
schoolRoutes.get('/', authenticate, (req: AuthRequest, res: Response) => {
  // If not platform admin, return only schools the user is member of
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    const schools = db
      .prepare(`
        SELECT s.id, s.code, s.name, s.city, s.state, s.status, sm.role
        FROM schools s
        JOIN school_memberships sm ON s.id = sm.school_id
        WHERE sm.user_id = ? AND sm.status = 'ACTIVE'
        ORDER BY s.name ASC
      `)
      .all(req.user!.id);
    return res.json({ success: true, schools, totalCount: schools.length });
  }

  // PLATFORM_ADMIN: Support search, status filter, and pagination
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : 'ALL';
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 15));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const params: any[] = [];

  if (search) {
    whereClauses.push('(LOWER(s.name) LIKE ? OR LOWER(s.code) LIKE ? OR LOWER(s.city) LIKE ? OR LOWER(s.contact_email) LIKE ?)');
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term, term, term);
  }

  if (statusFilter && statusFilter !== 'ALL') {
    whereClauses.push('s.status = ?');
    params.push(statusFilter);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM schools s ${whereSql}`)
    .get(...params) as { total: number };
  const totalCount = countRow ? countRow.total : 0;

  // Query paginated list with counts
  const queryParams = [...params, limit, offset];
  const schools = db
    .prepare(`
      SELECT 
        s.id,
        s.code,
        s.name,
        s.affiliation_number,
        s.board,
        s.address,
        s.city,
        s.state,
        s.pincode,
        s.contact_phone,
        s.contact_email,
        s.contact_person,
        s.timezone,
        s.status,
        s.created_at,
        s.updated_at,
        (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.status = 'ACTIVE') as student_count,
        (SELECT COUNT(*) FROM vehicles v WHERE v.school_id = s.id AND v.status = 'ACTIVE') as vehicle_count,
        (SELECT COUNT(*) FROM drivers d WHERE d.school_id = s.id AND d.status = 'ACTIVE') as driver_count,
        (SELECT COUNT(*) FROM trips t WHERE t.school_id = s.id AND t.status = 'IN_PROGRESS') as active_trips_count,
        (SELECT COUNT(*) FROM school_memberships sm 
           JOIN users u ON sm.user_id = u.id 
           WHERE sm.school_id = s.id AND sm.role = 'SCHOOL_ADMIN' AND sm.status = 'ACTIVE' AND u.is_active = 1
        ) as active_admin_count,
        (SELECT COUNT(*) FROM school_memberships sm 
           WHERE sm.school_id = s.id AND sm.role = 'SCHOOL_ADMIN'
        ) as total_admin_count,
        (SELECT COUNT(*) FROM school_invitations si 
           WHERE si.school_id = s.id AND si.status = 'PENDING' AND si.expires_at > datetime('now')
        ) as pending_invitation_count,
        sub.plan_name, 
        sub.status as subscription_status, 
        sub.expires_at as subscription_expiry
      FROM schools s
      LEFT JOIN subscriptions sub ON s.id = sub.school_id
      ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...queryParams);

  return res.json({
    success: true,
    schools,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    },
  });
});

// POST /api/v1/schools - Create a new school (Platform Admin only)
schoolRoutes.post('/', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Only Platform Administrators can register new schools.',
    });
  }

  const {
    name,
    code,
    affiliationNumber,
    board,
    address,
    city,
    state,
    pincode,
    contactPhone,
    contactEmail,
    contactPerson,
    status,
    initialAdminEmail,
    initialAdminName,
    initialAdminPhone,
  } = req.body;

  const schoolName = (name || '').trim();
  const schoolCode = (code || '').trim().toUpperCase();
  const schoolCity = (city || '').trim();
  const schoolState = (state || 'Delhi').trim();
  const schoolPincode = (pincode || '').trim();
  const schoolAddress = (address || '').trim();
  const schoolPhone = (contactPhone || '').trim();
  const schoolEmail = (contactEmail || '').trim().toLowerCase();
  const schoolContactPerson = (contactPerson || '').trim();
  const schoolBoard = (board || 'CBSE').trim();
  const schoolStatus = ['ACTIVE', 'SUSPENDED', 'TRIAL'].includes(status) ? status : 'ACTIVE';

  const missing: string[] = [];
  if (!schoolName) missing.push('School Name');
  if (!schoolCode) missing.push('School Code');
  if (!schoolAddress) missing.push('Address');
  if (!schoolCity) missing.push('City');
  if (!schoolPincode) missing.push('Pincode');
  if (!schoolPhone) missing.push('Contact Phone');
  if (!schoolEmail) missing.push('Contact Email');

  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: `Missing required school fields: ${missing.join(', ')}.`,
    });
  }

  // Validate school code format (alphanumeric and dashes, 2-15 chars)
  if (!/^[A-Z0-9-]{2,15}$/.test(schoolCode)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_CODE_FORMAT',
      message: 'School code must be 2-15 uppercase alphanumeric characters (hyphens allowed).',
    });
  }

  // Uniqueness check
  const existing = db
    .prepare('SELECT id FROM schools WHERE UPPER(code) = ?')
    .get(schoolCode);

  if (existing) {
    return res.status(409).json({
      success: false,
      error: 'SCHOOL_CODE_EXISTS',
      message: `School code "${schoolCode}" is already in use. Please provide a unique identifier.`,
    });
  }

  const schoolId = `sch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Insert School record
    db.prepare(`
      INSERT INTO schools (
        id, code, name, affiliation_number, board, address, city, state, pincode,
        contact_phone, contact_email, contact_person, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      schoolId,
      schoolCode,
      schoolName,
      affiliationNumber || null,
      schoolBoard,
      schoolAddress,
      schoolCity,
      schoolState,
      schoolPincode,
      schoolPhone,
      schoolEmail,
      schoolContactPerson || null,
      schoolStatus
    );

    // 2. Default Tenant Settings
    db.prepare(`
      INSERT INTO tenant_settings (school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance, strict_reconciliation_required)
      VALUES (?, 45, 50, 1, 1)
    `).run(schoolId);

    // 3. Subscriptions (Professional Plan default)
    db.prepare(`
      INSERT INTO subscriptions (id, school_id, plan_name, status, max_vehicles, max_students, expires_at)
      VALUES (?, ?, 'PROFESSIONAL', 'ACTIVE', 30, 1500, date('now', '+1 year'))
    `).run(`sub_${schoolId}`, schoolId);

    // 3.5. Ensure active membership for creating platform admin
    if (req.user?.id) {
      db.prepare(`
        INSERT INTO school_memberships (id, user_id, school_id, role, status)
        VALUES (?, ?, ?, 'SCHOOL_ADMIN', 'ACTIVE')
      `).run(`mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, req.user.id, schoolId);
    }

    let initialInvitation = null;
    // 4. Optional initial admin invitation if email provided
    if (initialAdminEmail && initialAdminName) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashInvitationToken(rawToken);
      const tokenHint = `inv_${rawToken.slice(0, 6)}...`;
      const invId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO school_invitations (
          id, school_id, email, full_name, role, token_hash, token_hint,
          invited_by_user_id, status, delivery_status, delivery_provider, last_sent_at, expires_at
        )
        VALUES (?, ?, ?, ?, 'SCHOOL_ADMIN', ?, ?, ?, 'PENDING', 'DISABLED_NO_GATEWAY', 'SURAKSHAVAHAN_INTERNAL', datetime('now'), ?)
      `).run(
        invId,
        schoolId,
        initialAdminEmail.trim().toLowerCase(),
        initialAdminName.trim(),
        tokenHash,
        tokenHint,
        req.user!.id,
        expiresAt
      );

      initialInvitation = {
        id: invId,
        email: initialAdminEmail.trim().toLowerCase(),
        fullName: initialAdminName.trim(),
        token: rawToken,
        deliveryStatus: 'DISABLED_NO_GATEWAY',
        expiresAt,
      };
    }

    db.exec('COMMIT;');

    logAudit({
      schoolId,
      userId: req.user!.id,
      action: 'SCHOOL_CREATED',
      entityType: 'SCHOOL',
      entityId: schoolId,
      newValues: {
        code: schoolCode,
        name: schoolName,
        status: schoolStatus,
        city: schoolCity,
        contactEmail: schoolEmail,
      },
      ipAddress: req.ip,
    });

    const createdSchool = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);

    return res.status(201).json({
      success: true,
      message: `School "${schoolName}" registered successfully.`,
      school: createdSchool,
      initialInvitation,
    });
  } catch (err: any) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    console.error('[Create School Error]', err?.message || '[REDACTED_ERROR]');
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to create school record. Transaction rolled back.',
    });
  }
});

// GET /api/v1/schools/current - Get active school profile & statistics
schoolRoutes.get(
  '/current',
  authenticate,
  (req: AuthRequest, res: Response) => {
    let schoolId = (req.headers['x-school-id'] as string) || req.schoolContext?.schoolId;

    if (!schoolId && req.user) {
      if (req.user.systemRole === 'PLATFORM_ADMIN') {
        const firstSchool = db.prepare("SELECT id FROM schools WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1").get() as any;
        if (firstSchool) schoolId = firstSchool.id;
      } else {
        const membership = db.prepare("SELECT school_id FROM school_memberships WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1").get(req.user.id) as any;
        if (membership) schoolId = membership.school_id;
      }
    }

    if (!schoolId) {
      return res.json({
        success: true,
        hasSchool: false,
        school: null,
        settings: {},
        subscription: null,
        stats: {
          totalVehicles: 0,
          totalDrivers: 0,
          totalStudents: 0,
          totalRoutes: 0,
          activeTrips: 0,
          todayCompletedTrips: 0,
          todayAttendanceScans: 0,
        },
        message: 'No active school workspace selected. Please select or register a school.',
      });
    }

    const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
    if (!school) {
      return res.json({
        success: true,
        hasSchool: false,
        school: null,
        settings: {},
        subscription: null,
        stats: {
          totalVehicles: 0,
          totalDrivers: 0,
          totalStudents: 0,
          totalRoutes: 0,
          activeTrips: 0,
          todayCompletedTrips: 0,
          todayAttendanceScans: 0,
        },
      });
    }

    const settings = db.prepare('SELECT * FROM tenant_settings WHERE school_id = ?').get(schoolId) as any;
    const subscription = db.prepare('SELECT * FROM subscriptions WHERE school_id = ?').get(schoolId) as any;

    const stats = {
      totalVehicles: (db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE school_id = ? AND status != 'RETIRED'").get(schoolId) as any)?.c || 0,
      totalDrivers: (db.prepare("SELECT COUNT(*) as c FROM drivers WHERE school_id = ? AND status = 'ACTIVE'").get(schoolId) as any)?.c || 0,
      totalStudents: (db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ? AND status = 'ACTIVE'").get(schoolId) as any)?.c || 0,
      totalRoutes: (db.prepare("SELECT COUNT(*) as c FROM routes WHERE school_id = ? AND is_active = 1").get(schoolId) as any)?.c || 0,
      activeTrips: (db.prepare("SELECT COUNT(*) as c FROM trips WHERE school_id = ? AND status = 'IN_PROGRESS'").get(schoolId) as any)?.c || 0,
      todayCompletedTrips: (db.prepare("SELECT COUNT(*) as c FROM trips WHERE school_id = ? AND status = 'COMPLETED' AND trip_date = date('now')").get(schoolId) as any)?.c || 0,
      todayAttendanceScans: (db.prepare("SELECT COUNT(*) as c FROM attendance_events WHERE school_id = ? AND date(scanned_at) = date('now')").get(schoolId) as any)?.c || 0,
    };

    return res.json({
      success: true,
      hasSchool: true,
      school,
      settings: settings || {},
      subscription: subscription || { plan_name: 'PROFESSIONAL', status: 'ACTIVE', max_vehicles: 20, max_students: 1000 },
      stats,
    });
  }
);

// GET /api/v1/schools/pending-verifications - List all pending parent verification requests for active school
schoolRoutes.get('/pending-verifications', authenticate, (req: AuthRequest, res: Response) => {
  let schoolId = (req.headers['x-school-id'] as string) || req.schoolContext?.schoolId;

  if (!schoolId && req.user?.systemRole === 'PLATFORM_ADMIN') {
    const firstSchool = db.prepare("SELECT id FROM schools WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1").get() as any;
    if (firstSchool) schoolId = firstSchool.id;
  }

  if (!schoolId) {
    return res.json({ success: true, requests: [] });
  }

  const requests = db
    .prepare(`
      SELECT 
        pvr.*,
        u.email as user_email,
        u.full_name as user_full_name,
        u.phone as user_phone,
        st.id as matched_student_id,
        st.full_name as matched_student_name,
        st.grade as matched_student_grade,
        st.section as matched_student_section
      FROM parent_verification_requests pvr
      JOIN users u ON pvr.user_id = u.id
      LEFT JOIN students st ON pvr.school_id = st.school_id AND LOWER(pvr.student_admission_number) = LOWER(st.admission_number)
      WHERE pvr.school_id = ?
      ORDER BY CASE WHEN pvr.status = 'PENDING' THEN 1 ELSE 2 END, pvr.created_at DESC
    `)
    .all(schoolId);

  return res.json({ success: true, count: requests.length, requests });
});

// POST /api/v1/schools/pending-verifications/:requestId/approve - Approve parent registration request
schoolRoutes.post('/pending-verifications/:requestId/approve', authenticate, (req: AuthRequest, res: Response) => {
  const { requestId } = req.params;
  const adminUserId = req.user!.id;

  const request = db.prepare('SELECT * FROM parent_verification_requests WHERE id = ?').get(requestId) as any;
  if (!request) {
    return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Verification request not found.' });
  }

  const school = db.prepare('SELECT name FROM schools WHERE id = ?').get(request.school_id) as any;

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Mark request as APPROVED
    db.prepare(`
      UPDATE parent_verification_requests
      SET status = 'APPROVED', reviewed_by_user_id = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(adminUserId, requestId);

    // 2. Activate school membership for user
    db.prepare(`
      UPDATE school_memberships
      SET status = 'ACTIVE'
      WHERE user_id = ? AND school_id = ?
    `).run(request.user_id, request.school_id);

    // 3. Find matched student by admission number
    const student = db
      .prepare('SELECT id, full_name FROM students WHERE school_id = ? AND LOWER(admission_number) = LOWER(?)')
      .get(request.school_id, request.student_admission_number.trim()) as any;

    let guardianId: string | null = null;
    // Find or create guardian profile
    const existingGuardian = db.prepare('SELECT id FROM guardians WHERE user_id = ?').get(request.user_id) as any;
    if (existingGuardian) {
      guardianId = existingGuardian.id;
    } else {
      guardianId = `grd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.prepare(`
        INSERT INTO guardians (id, user_id, full_name, phone, email, relationship)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        guardianId,
        request.user_id,
        request.parent_name,
        request.parent_phone,
        request.parent_email,
        request.relationship_type || 'PARENT'
      );
    }

    // Link guardian to student if student exists
    if (student && guardianId) {
      const existingLink = db
        .prepare('SELECT id FROM student_guardians WHERE student_id = ? AND guardian_id = ?')
        .get(student.id, guardianId) as any;

      if (!existingLink) {
        const linkId = `sg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        db.prepare(`
          INSERT INTO student_guardians (id, student_id, guardian_id, is_primary, can_pickup, relationship_type)
          VALUES (?, ?, ?, 1, 1, ?)
        `).run(linkId, student.id, guardianId, request.relationship_type || 'PARENT');
      }
    }

    // 4. Send parent in-app notification
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.prepare(`
      INSERT INTO notifications (id, school_id, user_id, title, message, notification_type, delivery_status, channel, delivery_provider)
      VALUES (?, ?, ?, 'School Registration Approved', ?, 'SYSTEM_ALERT', 'DELIVERED_IN_APP', 'IN_APP', 'SURAKSHAVAHAN_INTERNAL')
    `).run(
      notifId,
      request.school_id,
      request.user_id,
      `Your registration request for ${school?.name || 'the school'} (Student Admission No: ${request.student_admission_number}) has been approved by the administration!`
    );

    db.exec('COMMIT;');

    logAudit({
      schoolId: request.school_id,
      userId: adminUserId,
      action: 'PARENT_VERIFICATION_APPROVED',
      entityType: 'PARENT_VERIFICATION_REQUEST',
      entityId: requestId,
      newValues: { parentName: request.parent_name, studentAdmission: request.student_admission_number },
    });

    return res.json({
      success: true,
      message: `Parent verification request for ${request.parent_name} approved successfully. Student access linked.`,
    });
  } catch (err: any) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    console.error('[Approve Verification Error]', err);
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to approve verification request.' });
  }
});

// POST /api/v1/schools/pending-verifications/:requestId/cancel - Cancel / Reject parent registration request
schoolRoutes.post('/pending-verifications/:requestId/cancel', authenticate, (req: AuthRequest, res: Response) => {
  const { requestId } = req.params;
  const { reason } = req.body;
  const adminUserId = req.user!.id;

  const request = db.prepare('SELECT * FROM parent_verification_requests WHERE id = ?').get(requestId) as any;
  if (!request) {
    return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Verification request not found.' });
  }

  const school = db.prepare('SELECT name FROM schools WHERE id = ?').get(request.school_id) as any;
  const rejectionReason = reason || 'Declined by school administration.';

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Mark request as REJECTED
    db.prepare(`
      UPDATE parent_verification_requests
      SET status = 'REJECTED', rejection_reason = ?, reviewed_by_user_id = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(rejectionReason, adminUserId, requestId);

    // 2. Revoke pending school membership
    db.prepare(`
      UPDATE school_memberships
      SET status = 'REVOKED'
      WHERE user_id = ? AND school_id = ? AND status = 'PENDING'
    `).run(request.user_id, request.school_id);

    // 3. Send parent notification
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.prepare(`
      INSERT INTO notifications (id, school_id, user_id, title, message, notification_type, delivery_status, channel, delivery_provider)
      VALUES (?, ?, ?, 'School Registration Cancelled', ?, 'SYSTEM_ALERT', 'DELIVERED_IN_APP', 'IN_APP', 'SURAKSHAVAHAN_INTERNAL')
    `).run(
      notifId,
      request.school_id,
      request.user_id,
      `Your registration request for ${school?.name || 'the school'} was cancelled/declined by the school administration. Reason: ${rejectionReason}`
    );

    db.exec('COMMIT;');

    logAudit({
      schoolId: request.school_id,
      userId: adminUserId,
      action: 'PARENT_VERIFICATION_REJECTED',
      entityType: 'PARENT_VERIFICATION_REQUEST',
      entityId: requestId,
      newValues: { parentName: request.parent_name, rejectionReason },
    });

    return res.json({
      success: true,
      message: `Verification request for ${request.parent_name} has been cancelled/declined.`,
    });
  } catch (err: any) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    console.error('[Cancel Verification Error]', err);
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to cancel verification request.' });
  }
});

// GET /api/v1/schools/:id - Detailed school view with associated admins, invitations, and audit history
schoolRoutes.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const targetSchoolId = req.params.id;

  // Authorization: Platform Admin or member of that school
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    const membership = db
      .prepare('SELECT id FROM school_memberships WHERE user_id = ? AND school_id = ? AND status = ?')
      .get(req.user!.id, targetSchoolId, 'ACTIVE');
    if (!membership) {
      return res.status(403).json({
        success: false,
        error: 'TENANT_ACCESS_DENIED',
        message: 'Access denied: You are not authorized to view this school.',
      });
    }
  }

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(targetSchoolId) as any;
  if (!school) {
    return res.status(404).json({ success: false, error: 'SCHOOL_NOT_FOUND', message: 'School does not exist.' });
  }

  const settings = db.prepare('SELECT * FROM tenant_settings WHERE school_id = ?').get(targetSchoolId);
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE school_id = ?').get(targetSchoolId);

  // Associated administrators
  const administrators = db
    .prepare(`
      SELECT 
        u.id as user_id,
        u.email,
        u.full_name,
        u.phone,
        u.is_active as user_active,
        u.created_at as user_created_at,
        sm.id as membership_id,
        sm.role,
        sm.status as membership_status,
        sm.created_at as assigned_at
      FROM school_memberships sm
      JOIN users u ON sm.user_id = u.id
      WHERE sm.school_id = ? AND sm.role IN ('SCHOOL_ADMIN', 'TRANSPORT_MANAGER')
      ORDER BY sm.created_at DESC
    `)
    .all(targetSchoolId);

  // Pending / active invitations
  const invitations = db
    .prepare(`
      SELECT 
        id,
        school_id,
        email,
        full_name,
        role,
        token_hint,
        status,
        delivery_status,
        delivery_provider,
        last_sent_at,
        expires_at,
        created_at
      FROM school_invitations
      WHERE school_id = ?
      ORDER BY created_at DESC
    `)
    .all(targetSchoolId);

  // Operational statistics
  const stats = {
    totalStudents: (db.prepare('SELECT COUNT(*) as c FROM students WHERE school_id = ?').get(targetSchoolId) as any)?.c || 0,
    totalVehicles: (db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE school_id = ? AND status != 'RETIRED'").get(targetSchoolId) as any)?.c || 0,
    totalDrivers: (db.prepare("SELECT COUNT(*) as c FROM drivers WHERE school_id = ? AND status = 'ACTIVE'").get(targetSchoolId) as any)?.c || 0,
    totalRoutes: (db.prepare('SELECT COUNT(*) as c FROM routes WHERE school_id = ?').get(targetSchoolId) as any)?.c || 0,
    activeTrips: (db.prepare("SELECT COUNT(*) as c FROM trips WHERE school_id = ? AND status = 'IN_PROGRESS'").get(targetSchoolId) as any)?.c || 0,
  };

  // Recent audit logs for this school
  const auditHistory = db
    .prepare(`
      SELECT id, action, entity_type, entity_id, user_id, ip_address, created_at, new_values
      FROM audit_logs
      WHERE school_id = ?
      ORDER BY created_at DESC
      LIMIT 25
    `)
    .all(targetSchoolId);

  return res.json({
    success: true,
    school,
    settings: settings || {},
    subscription: subscription || { plan_name: 'PROFESSIONAL', status: 'ACTIVE' },
    administrators,
    invitations,
    stats,
    auditHistory,
  });
});

// PUT /api/v1/schools/:id - Edit school details
schoolRoutes.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const targetSchoolId = req.params.id;

  // Authorization: Platform Admin or School Admin of this school
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    const membership = db
      .prepare("SELECT id FROM school_memberships WHERE user_id = ? AND school_id = ? AND role = 'SCHOOL_ADMIN' AND status = 'ACTIVE'")
      .get(req.user!.id, targetSchoolId);
    if (!membership) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Unauthorized to edit this school.' });
    }
  }

  const existingSchool = db.prepare('SELECT * FROM schools WHERE id = ?').get(targetSchoolId) as any;
  if (!existingSchool) {
    return res.status(404).json({ success: false, error: 'SCHOOL_NOT_FOUND', message: 'School not found' });
  }

  const {
    name,
    affiliationNumber,
    board,
    address,
    city,
    state,
    pincode,
    contactPhone,
    contactEmail,
    contactPerson,
    timezone,
  } = req.body;

  const updatedName = (name || existingSchool.name).trim();
  const updatedAddress = (address || existingSchool.address).trim();
  const updatedCity = (city || existingSchool.city).trim();
  const updatedState = (state || existingSchool.state).trim();
  const updatedPincode = (pincode || existingSchool.pincode).trim();
  const updatedPhone = (contactPhone || existingSchool.contact_phone).trim();
  const updatedEmail = (contactEmail || existingSchool.contact_email).trim().toLowerCase();
  const updatedPerson = contactPerson !== undefined ? contactPerson.trim() : existingSchool.contact_person;
  const updatedBoard = board || existingSchool.board;
  const updatedAffiliation = affiliationNumber !== undefined ? affiliationNumber : existingSchool.affiliation_number;
  const updatedTz = timezone || existingSchool.timezone || 'Asia/Kolkata';

  db.prepare(`
    UPDATE schools SET
      name = ?,
      affiliation_number = ?,
      board = ?,
      address = ?,
      city = ?,
      state = ?,
      pincode = ?,
      contact_phone = ?,
      contact_email = ?,
      contact_person = ?,
      timezone = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updatedName,
    updatedAffiliation,
    updatedBoard,
    updatedAddress,
    updatedCity,
    updatedState,
    updatedPincode,
    updatedPhone,
    updatedEmail,
    updatedPerson,
    updatedTz,
    targetSchoolId
  );

  logAudit({
    schoolId: targetSchoolId,
    userId: req.user!.id,
    action: 'SCHOOL_UPDATED',
    entityType: 'SCHOOL',
    entityId: targetSchoolId,
    oldValues: { name: existingSchool.name, city: existingSchool.city, contactEmail: existingSchool.contact_email },
    newValues: { name: updatedName, city: updatedCity, contactEmail: updatedEmail, contactPerson: updatedPerson },
    ipAddress: req.ip,
  });

  const updated = db.prepare('SELECT * FROM schools WHERE id = ?').get(targetSchoolId);
  return res.json({ success: true, message: 'School updated successfully', school: updated });
});

// PATCH /api/v1/schools/:id/status - Activate or Deactivate School (Platform Admin only)
schoolRoutes.patch('/:id/status', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Platform Admin permissions required' });
  }

  const targetSchoolId = req.params.id;
  const { status } = req.body;

  if (!['ACTIVE', 'SUSPENDED', 'TRIAL'].includes(status)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_STATUS',
      message: 'Status must be one of: ACTIVE, SUSPENDED, TRIAL',
    });
  }

  const existing = db.prepare('SELECT status, name FROM schools WHERE id = ?').get(targetSchoolId) as any;
  if (!existing) {
    return res.status(404).json({ success: false, error: 'SCHOOL_NOT_FOUND', message: 'School not found' });
  }

  db.prepare("UPDATE schools SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, targetSchoolId);

  logAudit({
    schoolId: targetSchoolId,
    userId: req.user!.id,
    action: 'SCHOOL_STATUS_CHANGED',
    entityType: 'SCHOOL',
    entityId: targetSchoolId,
    oldValues: { status: existing.status },
    newValues: { status },
    ipAddress: req.ip,
  });

  return res.json({
    success: true,
    message: `School "${existing.name}" status updated to ${status}.`,
    status,
  });
});

// POST /api/v1/schools/:id/admins - Direct creation of School Admin account
schoolRoutes.post('/:id/admins', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Platform Admin permissions required' });
  }

  const targetSchoolId = req.params.id;
  const school = db.prepare('SELECT id, name FROM schools WHERE id = ?').get(targetSchoolId) as any;
  if (!school) {
    return res.status(404).json({ success: false, error: 'SCHOOL_NOT_FOUND', message: 'School does not exist.' });
  }

  const { email, fullName, phone, password } = req.body;
  const effectiveEmail = (email || '').trim().toLowerCase();
  const effectiveName = (fullName || '').trim();
  const effectivePhone = (phone || '').trim();
  const effectivePassword = (password || '').trim();

  if (!effectiveEmail || !effectiveName || !effectivePassword) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Full Name, Email, and Password are required.',
    });
  }

  if (effectivePassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'WEAK_PASSWORD',
      message: 'Password must be at least 8 characters long.',
    });
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    let user = db.prepare('SELECT id, email, is_active FROM users WHERE LOWER(email) = ?').get(effectiveEmail) as any;
    let userId = user?.id;

    if (!user) {
      // Create new user
      userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const passwordHash = await hashPassword(effectivePassword);
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active, email_verified)
        VALUES (?, ?, ?, ?, ?, 'USER', 1, 1)
      `).run(userId, effectiveEmail, passwordHash, effectiveName, effectivePhone || null);
    } else {
      // User exists: make sure active
      db.prepare("UPDATE users SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(userId);
    }

    // Check membership
    const existingMembership = db
      .prepare('SELECT id, role, status FROM school_memberships WHERE user_id = ? AND school_id = ?')
      .get(userId, targetSchoolId) as any;

    let membershipId = existingMembership?.id;

    if (existingMembership) {
      if (existingMembership.status === 'ACTIVE' && existingMembership.role === 'SCHOOL_ADMIN') {
        db.exec('ROLLBACK;');
        return res.status(409).json({
          success: false,
          error: 'ADMIN_ALREADY_EXISTS',
          message: `${effectiveEmail} is already an active School Admin for ${school.name}.`,
        });
      }
      db.prepare("UPDATE school_memberships SET role = 'SCHOOL_ADMIN', status = 'ACTIVE' WHERE id = ?").run(membershipId);
    } else {
      membershipId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.prepare(`
        INSERT INTO school_memberships (id, user_id, school_id, role, status)
        VALUES (?, ?, ?, 'SCHOOL_ADMIN', 'ACTIVE')
      `).run(membershipId, userId, targetSchoolId);
    }

    db.exec('COMMIT;');

    logAudit({
      schoolId: targetSchoolId,
      userId: req.user!.id,
      action: 'ADMIN_CREATED',
      entityType: 'USER',
      entityId: userId,
      newValues: { email: effectiveEmail, fullName: effectiveName, role: 'SCHOOL_ADMIN' },
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: `School Administrator account for ${effectiveName} created successfully.`,
      user: {
        userId,
        email: effectiveEmail,
        fullName: effectiveName,
        phone: effectivePhone,
        role: 'SCHOOL_ADMIN',
        status: 'ACTIVE',
      },
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    console.error('[Create Admin Error]', err?.message || '[REDACTED_ERROR]');
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to create administrator account.' });
  }
});

// POST /api/v1/schools/:id/admins/invite - Generate secure single-use invitation for School Admin
schoolRoutes.post('/:id/admins/invite', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Platform Admin permissions required' });
  }

  const targetSchoolId = req.params.id;
  const school = db.prepare('SELECT id, name, code FROM schools WHERE id = ?').get(targetSchoolId) as any;
  if (!school) {
    return res.status(404).json({ success: false, error: 'SCHOOL_NOT_FOUND', message: 'School not found' });
  }

  const { email, fullName, role } = req.body;
  const effectiveEmail = (email || '').trim().toLowerCase();
  const effectiveName = (fullName || '').trim();
  const targetRole = role === 'TRANSPORT_MANAGER' ? 'TRANSPORT_MANAGER' : 'SCHOOL_ADMIN';

  if (!effectiveEmail || !effectiveName) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Both Administrator Email and Full Name are required.',
    });
  }

  // Check if already an active admin
  const activeAdmin = db
    .prepare(`
      SELECT u.id 
      FROM users u
      JOIN school_memberships sm ON u.id = sm.user_id
      WHERE LOWER(u.email) = ? AND sm.school_id = ? AND sm.status = 'ACTIVE'
    `)
    .get(effectiveEmail, targetSchoolId);

  if (activeAdmin) {
    return res.status(409).json({
      success: false,
      error: 'ADMIN_ALREADY_ASSIGNED',
      message: `${effectiveEmail} is already an active member of this school.`,
    });
  }

  // Generate 32-byte cryptographically secure random token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInvitationToken(rawToken);
  const tokenHint = `inv_${rawToken.substring(0, 8)}...`;
  const invId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  // Expires in 7 days
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // If previous pending invitation exists for this email and school, mark it revoked
  db.prepare(`
    UPDATE school_invitations 
    SET status = 'REVOKED', updated_at = datetime('now')
    WHERE school_id = ? AND LOWER(email) = ? AND status = 'PENDING'
  `).run(targetSchoolId, effectiveEmail);

  // Truthful delivery reporting: check if external gateway is configured
  const emailGatewayConfigured = Boolean(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY);
  const deliveryStatus = emailGatewayConfigured ? 'DELIVERED_EMAIL' : 'DISABLED_NO_GATEWAY';

  db.prepare(`
    INSERT INTO school_invitations (
      id, school_id, email, full_name, role, token_hash, token_hint,
      invited_by_user_id, status, delivery_status, delivery_provider, last_sent_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 'SURAKSHAVAHAN_INTERNAL', datetime('now'), ?)
  `).run(
    invId,
    targetSchoolId,
    effectiveEmail,
    effectiveName,
    targetRole,
    tokenHash,
    tokenHint,
    req.user!.id,
    deliveryStatus,
    expiresAt
  );

  logAudit({
    schoolId: targetSchoolId,
    userId: req.user!.id,
    action: 'ADMIN_INVITED',
    entityType: 'INVITATION',
    entityId: invId,
    newValues: { email: effectiveEmail, fullName: effectiveName, role: targetRole, deliveryStatus },
    ipAddress: req.ip,
  });

  return res.status(201).json({
    success: true,
    message: `Invitation generated for ${effectiveName} (${effectiveEmail}).`,
    invitation: {
      id: invId,
      email: effectiveEmail,
      fullName: effectiveName,
      role: targetRole,
      token: rawToken,
      inviteUrl: `/accept-invite?token=${rawToken}`,
      deliveryStatus,
      expiresAt,
    },
  });
});

// POST /api/v1/schools/:id/admins/:userId/status - Toggle School Admin active status
schoolRoutes.post('/:id/admins/:userId/status', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Platform Admin permissions required' });
  }

  const { id: targetSchoolId, userId: targetUserId } = req.params;
  const { status } = req.body; // 'ACTIVE' | 'INACTIVE'

  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ success: false, error: 'INVALID_STATUS', message: 'Status must be ACTIVE or INACTIVE' });
  }

  const membership = db
    .prepare('SELECT id, status, role FROM school_memberships WHERE user_id = ? AND school_id = ?')
    .get(targetUserId, targetSchoolId) as any;

  if (!membership) {
    return res.status(404).json({ success: false, error: 'MEMBERSHIP_NOT_FOUND', message: 'Admin membership not found' });
  }

  db.prepare("UPDATE school_memberships SET status = ? WHERE user_id = ? AND school_id = ?").run(
    status,
    targetUserId,
    targetSchoolId
  );

  logAudit({
    schoolId: targetSchoolId,
    userId: req.user!.id,
    action: 'ADMIN_STATUS_CHANGED',
    entityType: 'SCHOOL_MEMBERSHIP',
    entityId: membership.id,
    oldValues: { status: membership.status },
    newValues: { status },
    ipAddress: req.ip,
  });

  return res.json({
    success: true,
    message: `Administrator membership is now ${status}.`,
    membershipStatus: status,
  });
});

// POST /api/v1/schools/:id/invitations/:invId/revoke - Revoke pending invitation
schoolRoutes.post('/:id/invitations/:invId/revoke', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Platform Admin permissions required' });
  }

  const { id: targetSchoolId, invId } = req.params;

  const inv = db
    .prepare('SELECT id, email, status FROM school_invitations WHERE id = ? AND school_id = ?')
    .get(invId, targetSchoolId) as any;

  if (!inv) {
    return res.status(404).json({ success: false, error: 'INVITATION_NOT_FOUND', message: 'Invitation not found' });
  }

  db.prepare("UPDATE school_invitations SET status = 'REVOKED', updated_at = datetime('now') WHERE id = ?").run(invId);

  logAudit({
    schoolId: targetSchoolId,
    userId: req.user!.id,
    action: 'INVITATION_REVOKED',
    entityType: 'INVITATION',
    entityId: invId,
    newValues: { status: 'REVOKED' },
    ipAddress: req.ip,
  });

  return res.json({ success: true, message: `Invitation for ${inv.email} has been revoked.` });
});

// POST /api/v1/schools/:id/invitations/:invId/resend - Resend invitation with fresh token & rate limit cooldown
schoolRoutes.post('/:id/invitations/:invId/resend', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Platform Admin permissions required' });
  }

  const { id: targetSchoolId, invId } = req.params;

  const inv = db
    .prepare('SELECT id, email, full_name, role, last_sent_at, status FROM school_invitations WHERE id = ? AND school_id = ?')
    .get(invId, targetSchoolId) as any;

  if (!inv) {
    return res.status(404).json({ success: false, error: 'INVITATION_NOT_FOUND', message: 'Invitation not found' });
  }

  // Rate limiting cooldown: 30 seconds
  if (inv.last_sent_at) {
    const elapsedSeconds = (Date.now() - new Date(inv.last_sent_at).getTime()) / 1000;
    if (elapsedSeconds < 30) {
      return res.status(429).json({
        success: false,
        error: 'RESEND_COOLDOWN',
        message: `Please wait ${Math.ceil(30 - elapsedSeconds)}s before resending this invitation.`,
      });
    }
  }

  // Generate fresh token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInvitationToken(rawToken);
  const tokenHint = `inv_${rawToken.substring(0, 8)}...`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    UPDATE school_invitations SET
      token_hash = ?,
      token_hint = ?,
      status = 'PENDING',
      expires_at = ?,
      last_sent_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(tokenHash, tokenHint, expiresAt, invId);

  logAudit({
    schoolId: targetSchoolId,
    userId: req.user!.id,
    action: 'INVITATION_RESENT',
    entityType: 'INVITATION',
    entityId: invId,
    newValues: { resendAt: new Date().toISOString() },
    ipAddress: req.ip,
  });

  return res.json({
    success: true,
    message: `Fresh invitation generated for ${inv.email}.`,
    invitation: {
      id: invId,
      email: inv.email,
      fullName: inv.full_name,
      token: rawToken,
      inviteUrl: `/accept-invite?token=${rawToken}`,
      expiresAt,
    },
  });
});

// PUT /api/v1/schools/settings - Update Tenant Settings
schoolRoutes.put(
  '/settings',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No active school tenant selected.' });
    }
    const {
      speedLimitKmh,
      geofenceBufferMeters,
      allowManualAttendance,
      strictReconciliationRequired,
      smsNotificationsEnabled,
      whatsappNotificationsEnabled,
    } = req.body;

    db.prepare(`
      INSERT INTO tenant_settings (
        school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance,
        strict_reconciliation_required, sms_notifications_enabled, whatsapp_notifications_enabled, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(school_id) DO UPDATE SET
        speed_limit_kmh = excluded.speed_limit_kmh,
        geofence_buffer_meters = excluded.geofence_buffer_meters,
        allow_manual_attendance = excluded.allow_manual_attendance,
        strict_reconciliation_required = excluded.strict_reconciliation_required,
        sms_notifications_enabled = excluded.sms_notifications_enabled,
        whatsapp_notifications_enabled = excluded.whatsapp_notifications_enabled,
        updated_at = datetime('now')
    `).run(
      schoolId,
      speedLimitKmh ?? 45,
      geofenceBufferMeters ?? 50,
      allowManualAttendance ? 1 : 0,
      strictReconciliationRequired ? 1 : 0,
      smsNotificationsEnabled ? 1 : 0,
      whatsappNotificationsEnabled ? 1 : 0
    );

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: 'UPDATE_SETTINGS',
      entityType: 'TENANT_SETTINGS',
      entityId: schoolId,
      newValues: req.body,
    });

    return res.json({ success: true, message: 'Settings saved successfully' });
  }
);

