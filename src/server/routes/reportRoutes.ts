import { Router, Response } from 'express';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, logAudit } from '../auth.ts';

export const reportRoutes = Router();

// GET /api/v1/reports/attendance-csv - Export CSV of attendance records with school authorization
reportRoutes.get(
  '/attendance-csv',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
    const fromDate = (req.query.fromDate as string) || '';
    const toDate = (req.query.toDate as string) || '';

    let query = `
      SELECT ae.id, ae.scanned_at, ae.event_type, ae.scan_method, ae.verification_status, ae.manual_reason,
        s.admission_number, s.full_name as student_name, s.grade, s.section, s.emergency_phone,
        t.id as trip_id, t.trip_type, t.trip_date,
        r.route_code, r.name as route_name,
        rs.stop_name,
        v.bus_number,
        u.full_name as scanned_by_name
      FROM attendance_events ae
      JOIN students s ON ae.student_id = s.id
      JOIN trips t ON ae.trip_id = t.id
      JOIN routes r ON t.route_id = r.id
      JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN route_stops rs ON ae.stop_id = rs.id
      LEFT JOIN users u ON ae.scanned_by_user_id = u.id
      WHERE ae.school_id = ?
    `;
    const params: any[] = [schoolId];

    if (fromDate) {
      query += ` AND date(ae.scanned_at) >= ?`;
      params.push(fromDate);
    }
    if (toDate) {
      query += ` AND date(ae.scanned_at) <= ?`;
      params.push(toDate);
    }

    query += ` ORDER BY ae.scanned_at DESC LIMIT 5000`;

    const records = db.prepare(query).all(...params) as any[];

    // Generate CSV
    const headers = [
      'Event ID',
      'Timestamp',
      'Event Type',
      'Scan Method',
      'Status',
      'Admission Number',
      'Student Name',
      'Grade & Sec',
      'Route Code',
      'Route Name',
      'Stop Name',
      'Bus Number',
      'Scanned By',
      'Manual Reason',
    ];

    const rows = records.map((r) => [
      r.id,
      r.scanned_at,
      r.event_type,
      r.scan_method,
      r.verification_status,
      r.admission_number,
      `"${r.student_name.replace(/"/g, '""')}"`,
      `"${r.grade}-${r.section}"`,
      r.route_code,
      `"${r.route_name.replace(/"/g, '""')}"`,
      `"${(r.stop_name || 'N/A').replace(/"/g, '""')}"`,
      r.bus_number,
      `"${(r.scanned_by_name || '').replace(/"/g, '""')}"`,
      `"${(r.manual_reason || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: 'EXPORT_ATTENDANCE_CSV',
      entityType: 'REPORT',
      newValues: { rowCount: records.length, fromDate, toDate },
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${schoolId}.csv"`);
    return res.send(csvContent);
  }
);

// GET /api/v1/reports/trips-csv - Export CSV of completed trips & metrics
reportRoutes.get(
  '/trips-csv',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
    const trips = db
      .prepare(`
        SELECT t.id, t.trip_type, t.trip_date, t.scheduled_start_time, t.actual_start_time, t.actual_end_time, t.status,
          r.route_code, r.name as route_name,
          v.bus_number, v.registration_number,
          d.full_name as driver_name,
          (SELECT COUNT(DISTINCT ae.student_id) FROM attendance_events ae WHERE ae.trip_id = t.id AND ae.event_type = 'BOARDING') as boarded_students,
          (SELECT COUNT(DISTINCT ae.student_id) FROM attendance_events ae WHERE ae.trip_id = t.id AND ae.event_type = 'DROP_OFF') as dropped_students
        FROM trips t
        JOIN routes r ON t.route_id = r.id
        JOIN vehicles v ON t.vehicle_id = v.id
        JOIN drivers d ON t.driver_id = d.id
        WHERE t.school_id = ?
        ORDER BY t.created_at DESC
        LIMIT 2000
      `)
      .all(schoolId) as any[];

    const headers = [
      'Trip ID',
      'Trip Type',
      'Date',
      'Scheduled Start',
      'Actual Start',
      'Actual End',
      'Status',
      'Route Code',
      'Route Name',
      'Bus Number',
      'Registration',
      'Driver Name',
      'Boarded Students',
      'Dropped Students',
    ];

    const rows = trips.map((t) => [
      t.id,
      t.trip_type,
      t.trip_date,
      t.scheduled_start_time,
      t.actual_start_time || 'N/A',
      t.actual_end_time || 'N/A',
      t.status,
      t.route_code,
      `"${t.route_name.replace(/"/g, '""')}"`,
      t.bus_number,
      t.registration_number,
      `"${t.driver_name.replace(/"/g, '""')}"`,
      t.boarded_students,
      t.dropped_students,
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trips-log-${schoolId}.csv"`);
    return res.send(csv);
  }
);

// GET /api/v1/reports/safety-exceptions - Safety exceptions & manual attendance overrides
reportRoutes.get(
  '/safety-exceptions',
  authenticate,
  requireSchoolContext(),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_ACTIVE_SCHOOL', message: 'Active school context required' });
      }

      const manualOverrides = db
        .prepare(`
          SELECT ae.*, s.full_name as student_name, s.admission_number, u.full_name as logged_by_name,
            r.name as route_name, v.bus_number
          FROM attendance_events ae
          JOIN students s ON ae.student_id = s.id
          LEFT JOIN trips t ON ae.trip_id = t.id
          LEFT JOIN routes r ON t.route_id = r.id
          LEFT JOIN vehicles v ON t.vehicle_id = v.id
          LEFT JOIN users u ON ae.scanned_by_user_id = u.id
          WHERE ae.school_id = ? AND ae.scan_method = 'MANUAL'
          ORDER BY ae.scanned_at DESC
          LIMIT 100
        `)
        .all(schoolId);

      const speedAlerts = db
        .prepare(`
          SELECT bl.*, t.id as trip_id, r.name as route_name, v.bus_number, d.full_name as driver_name,
            COALESCE(ts.speed_limit_kmh, 45) as speed_limit_kmh
          FROM bus_locations bl
          JOIN trips t ON bl.trip_id = t.id
          LEFT JOIN routes r ON t.route_id = r.id
          LEFT JOIN vehicles v ON t.vehicle_id = v.id
          LEFT JOIN drivers d ON t.driver_id = d.id
          LEFT JOIN tenant_settings ts ON t.school_id = ts.school_id
          WHERE t.school_id = ? AND bl.speed_kmh > COALESCE(ts.speed_limit_kmh, 45)
          ORDER BY bl.recorded_at DESC
          LIMIT 50
        `)
        .all(schoolId);

      // Also fetch recent all attendance events (both QR and manual) for comprehensive view
      const allEvents = db
        .prepare(`
          SELECT ae.*, s.full_name as student_name, s.admission_number, s.grade, s.section,
            r.name as route_name, r.route_code, v.bus_number, rs.stop_name, u.full_name as scanned_by_name
          FROM attendance_events ae
          JOIN students s ON ae.student_id = s.id
          LEFT JOIN trips t ON ae.trip_id = t.id
          LEFT JOIN routes r ON t.route_id = r.id
          LEFT JOIN vehicles v ON t.vehicle_id = v.id
          LEFT JOIN route_stops rs ON ae.stop_id = rs.id
          LEFT JOIN users u ON ae.scanned_by_user_id = u.id
          WHERE ae.school_id = ?
          ORDER BY ae.scanned_at DESC
          LIMIT 100
        `)
        .all(schoolId);

      return res.json({ success: true, manualOverrides, speedAlerts, allEvents });
    } catch (err: any) {
      console.error('[Safety Exceptions Error]', err);
      return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: err.message || 'Failed to fetch safety exceptions' });
    }
  }
);
