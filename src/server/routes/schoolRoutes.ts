import { Router, Response } from 'express';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, logAudit } from '../auth.ts';

export const schoolRoutes = Router();

// GET /api/v1/schools - List all schools (Platform Admin only)
schoolRoutes.get('/', authenticate, (req: AuthRequest, res: Response) => {
  if (req.user?.systemRole !== 'PLATFORM_ADMIN') {
    // If not platform admin, return only schools the user is member of
    const schools = db
      .prepare(`
        SELECT s.id, s.code, s.name, s.city, s.state, s.status, sm.role
        FROM schools s
        JOIN school_memberships sm ON s.id = sm.school_id
        WHERE sm.user_id = ? AND sm.status = 'ACTIVE'
      `)
      .all(req.user!.id);
    return res.json({ success: true, schools });
  }

  const schools = db
    .prepare(`
      SELECT s.*, 
        (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.status = 'ACTIVE') as student_count,
        (SELECT COUNT(*) FROM vehicles v WHERE v.school_id = s.id AND v.status = 'ACTIVE') as vehicle_count,
        (SELECT COUNT(*) FROM drivers d WHERE d.school_id = s.id AND d.status = 'ACTIVE') as driver_count,
        (SELECT COUNT(*) FROM trips t WHERE t.school_id = s.id AND t.status = 'IN_PROGRESS') as active_trips_count,
        sub.plan_name, sub.status as subscription_status, sub.expires_at as subscription_expiry
      FROM schools s
      LEFT JOIN subscriptions sub ON s.id = sub.school_id
      ORDER BY s.created_at DESC
    `)
    .all();

  return res.json({ success: true, schools });
});

// GET /api/v1/schools/current - Get active school profile & statistics
schoolRoutes.get(
  '/current',
  authenticate,
  requireSchoolContext(),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;

    const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
    if (!school) {
      return res.status(404).json({ success: false, error: 'SCHOOL_NOT_FOUND' });
    }

    const settings = db.prepare('SELECT * FROM tenant_settings WHERE school_id = ?').get(schoolId) as any;
    const subscription = db.prepare('SELECT * FROM subscriptions WHERE school_id = ?').get(schoolId) as any;

    const stats = {
      totalVehicles: (db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE school_id = ? AND status != 'RETIRED'").get(schoolId) as any).c,
      totalDrivers: (db.prepare("SELECT COUNT(*) as c FROM drivers WHERE school_id = ? AND status = 'ACTIVE'").get(schoolId) as any).c,
      totalStudents: (db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ? AND status = 'ACTIVE'").get(schoolId) as any).c,
      totalRoutes: (db.prepare("SELECT COUNT(*) as c FROM routes WHERE school_id = ? AND is_active = 1").get(schoolId) as any).c,
      activeTrips: (db.prepare("SELECT COUNT(*) as c FROM trips WHERE school_id = ? AND status = 'IN_PROGRESS'").get(schoolId) as any).c,
      todayCompletedTrips: (db.prepare("SELECT COUNT(*) as c FROM trips WHERE school_id = ? AND status = 'COMPLETED' AND trip_date = date('now')").get(schoolId) as any).c,
      todayAttendanceScans: (db.prepare("SELECT COUNT(*) as c FROM attendance_events WHERE school_id = ? AND date(scanned_at) = date('now')").get(schoolId) as any).c,
    };

    return res.json({
      success: true,
      school,
      settings: settings || {},
      subscription: subscription || { plan_name: 'PROFESSIONAL', status: 'ACTIVE', max_vehicles: 20, max_students: 1000 },
      stats,
    });
  }
);

// PUT /api/v1/schools/settings - Update Tenant Settings
schoolRoutes.put(
  '/settings',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
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
