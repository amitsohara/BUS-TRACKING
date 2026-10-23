import { Router, Response } from 'express';
import { db } from '../db.ts';
import { authenticate, AuthRequest } from '../auth.ts';

export const parentRoutes = Router();

// GET /api/v1/parents/children - Get all linked children for authenticated parent
parentRoutes.get('/children', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  // Find guardian record for this user
  const guardian = db.prepare('SELECT id, full_name, phone FROM guardians WHERE user_id = ?').get(userId) as any;
  if (!guardian) {
    return res.json({ success: true, children: [], message: 'No guardian profile linked to this user.' });
  }

  // Fetch only students linked to this guardian
  const children = db
    .prepare(`
      SELECT s.id, s.admission_number, s.full_name, s.grade, s.section, s.emergency_phone,
        s.school_id, sch.name as school_name, sch.contact_phone as school_phone,
        sg.relationship_type, sg.is_primary,
        ta.morning_route_id, ta.morning_stop_id,
        r1.route_code as morning_route_code, r1.name as morning_route_name,
        rs1.stop_name as morning_stop_name, rs1.morning_scheduled_time, rs1.latitude as morning_stop_lat, rs1.longitude as morning_stop_lng,
        ta.evening_route_id, ta.evening_stop_id,
        r2.route_code as evening_route_code, r2.name as evening_route_name,
        rs2.stop_name as evening_stop_name, rs2.evening_scheduled_time, rs2.latitude as evening_stop_lat, rs2.longitude as evening_stop_lng
      FROM student_guardians sg
      JOIN students s ON sg.student_id = s.id
      JOIN schools sch ON s.school_id = sch.id
      LEFT JOIN transport_assignments ta ON s.id = ta.student_id AND ta.is_active = 1
      LEFT JOIN routes r1 ON ta.morning_route_id = r1.id
      LEFT JOIN route_stops rs1 ON ta.morning_stop_id = rs1.id
      LEFT JOIN routes r2 ON ta.evening_route_id = r2.id
      LEFT JOIN route_stops rs2 ON ta.evening_stop_id = rs2.id
      WHERE sg.guardian_id = ?
    `)
    .all(guardian.id) as any[];

  // For each child, find any active or today's trip
  const enrichedChildren = children.map((child) => {
    // Check if there is an active trip on either morning or evening route
    const activeTrip = db
      .prepare(`
        SELECT t.id as trip_id, t.trip_type, t.status, t.scheduled_start_time, t.actual_start_time,
          v.bus_number, v.registration_number,
          d.full_name as driver_name, d.phone as driver_phone
        FROM trips t
        JOIN vehicles v ON t.vehicle_id = v.id
        JOIN drivers d ON t.driver_id = d.id
        WHERE (t.route_id = ? OR t.route_id = ?) AND t.status = 'IN_PROGRESS'
        ORDER BY t.created_at DESC
        LIMIT 1
      `)
      .get(child.morning_route_id, child.evening_route_id) as any;

    let latestLocation = null;
    let attendanceToday = null;

    if (activeTrip) {
      latestLocation = db
        .prepare('SELECT latitude, longitude, speed_kmh, heading, accuracy_meters, recorded_at FROM bus_locations WHERE trip_id = ? ORDER BY recorded_at DESC LIMIT 1')
        .get(activeTrip.trip_id) as any;

      attendanceToday = db
        .prepare(`
          SELECT event_type, scanned_at, scan_method, rs.stop_name
          FROM attendance_events ae
          LEFT JOIN route_stops rs ON ae.stop_id = rs.id
          WHERE ae.trip_id = ? AND ae.student_id = ?
          ORDER BY ae.scanned_at DESC
        `)
        .all(activeTrip.trip_id, child.id);
    } else {
      // Look for latest completed trip today
      attendanceToday = db
        .prepare(`
          SELECT ae.event_type, ae.scanned_at, ae.scan_method, rs.stop_name
          FROM attendance_events ae
          LEFT JOIN route_stops rs ON ae.stop_id = rs.id
          WHERE ae.student_id = ? AND date(ae.scanned_at) = date('now')
          ORDER BY ae.scanned_at DESC
        `)
        .all(child.id);
    }

    let freshness = null;
    if (latestLocation) {
      const recordedMillis = new Date(latestLocation.recorded_at).getTime();
      const secondsAgo = Math.floor((Date.now() - recordedMillis) / 1000);
      freshness = {
        secondsAgo,
        isStale: secondsAgo > 120,
        lastUpdated: latestLocation.recorded_at,
      };
    }

    return {
      ...child,
      activeTrip: activeTrip || null,
      latestLocation,
      freshness,
      attendanceToday: attendanceToday || [],
    };
  });

  return res.json({ success: true, children: enrichedChildren });
});

// GET /api/v1/parents/notifications - Notifications for this parent
parentRoutes.get('/notifications', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const notifications = db
    .prepare(`
      SELECT n.*, s.full_name as student_name
      FROM notifications n
      LEFT JOIN students s ON n.related_student_id = s.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `)
    .all(userId);

  return res.json({ success: true, notifications });
});

// POST /api/v1/parents/notifications/mark-read - Mark notification as read
parentRoutes.post('/notifications/mark-read', authenticate, (req: AuthRequest, res: Response) => {
  const { notificationId } = req.body;
  if (notificationId) {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?").run(
      notificationId,
      req.user!.id
    );
  } else {
    // Mark all read
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(
      req.user!.id
    );
  }
  return res.json({ success: true });
});

// POST /api/v1/parents/device-token - Register FCM/APNs push device token for Parent App
parentRoutes.post('/device-token', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { token, platform } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Device push token is required.' });
  }

  const effectivePlatform = ['ANDROID', 'IOS', 'WEB'].includes(platform?.toUpperCase()) ? platform.toUpperCase() : 'ANDROID';
  const tokenId = `tok_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  db.prepare(`
    INSERT INTO device_tokens (id, user_id, token, platform, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, token) DO UPDATE SET platform = excluded.platform, updated_at = datetime('now')
  `).run(tokenId, userId, token.trim(), effectivePlatform);

  return res.json({ success: true, message: 'Device token registered successfully.' });
});

// GET /api/v1/parents/children/:studentId/attendance - Child's complete attendance event history
parentRoutes.get('/children/:studentId/attendance', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { studentId } = req.params;

  // Strict DPDP privacy check: Verify parent is linked to this student
  const linked = db
    .prepare(`
      SELECT 1 FROM student_guardians sg
      JOIN guardians g ON sg.guardian_id = g.id
      WHERE sg.student_id = ? AND g.user_id = ?
    `)
    .get(studentId, userId);

  if (!linked && req.user!.systemRole !== 'PLATFORM_ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Access denied: You are only permitted to view attendance records for your own children.',
    });
  }

  const events = db
    .prepare(`
      SELECT ae.id, ae.trip_id, ae.event_type, ae.scan_method, ae.scanned_at, ae.verification_status,
        rs.stop_name, t.trip_type, t.trip_date, v.bus_number, v.registration_number
      FROM attendance_events ae
      LEFT JOIN route_stops rs ON ae.stop_id = rs.id
      JOIN trips t ON ae.trip_id = t.id
      JOIN vehicles v ON t.vehicle_id = v.id
      WHERE ae.student_id = ?
      ORDER BY ae.scanned_at DESC
      LIMIT 100
    `)
    .all(studentId);

  return res.json({ success: true, studentId, count: events.length, attendance: events });
});

// GET /api/v1/parents/active-schools - Get active schools for parent verification lookup
parentRoutes.get('/active-schools', authenticate, (req: AuthRequest, res: Response) => {
  const schools = db
    .prepare("SELECT id, name, code, city, state FROM schools WHERE status = 'ACTIVE' ORDER BY name ASC")
    .all();
  return res.json({ success: true, schools });
});

// POST /api/v1/parents/request-school-verification - Parent requests link/verification with a school
parentRoutes.post('/request-school-verification', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { schoolCode, studentAdmissionNumber, studentName, parentName, relationship } = req.body;

  if (!schoolCode || !studentAdmissionNumber) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'School Code and Student Admission Number are required.',
    });
  }

  // Find target school
  const school = db.prepare("SELECT id, name, code FROM schools WHERE LOWER(code) = LOWER(?) AND status = 'ACTIVE'").get(schoolCode.trim()) as any;
  if (!school) {
    return res.status(404).json({
      success: false,
      error: 'SCHOOL_NOT_FOUND',
      message: `No active school found with code "${schoolCode}". Please verify the code with your school administration.`,
    });
  }

  // Check if a pending request already exists for this user and student admission
  const existingReq = db
    .prepare('SELECT id, status FROM parent_verification_requests WHERE user_id = ? AND school_id = ? AND LOWER(student_admission_number) = LOWER(?)')
    .get(userId, school.id, studentAdmissionNumber.trim()) as any;

  if (existingReq && existingReq.status === 'PENDING') {
    return res.status(409).json({
      success: false,
      error: 'REQUEST_ALREADY_PENDING',
      message: 'You already have a pending verification request for this school and admission number.',
    });
  }

  const requestId = `pvr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const user = db.prepare('SELECT full_name, phone, email FROM users WHERE id = ?').get(userId) as any;

  const effectiveParentName = parentName || user?.full_name || 'Parent';
  const effectiveParentPhone = user?.phone || '+91 98000 00000';
  const effectiveParentEmail = user?.email || null;

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Insert verification request
    db.prepare(`
      INSERT INTO parent_verification_requests (id, school_id, user_id, parent_name, parent_phone, parent_email, student_admission_number, student_name, relationship_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `).run(
      requestId,
      school.id,
      userId,
      effectiveParentName,
      effectiveParentPhone,
      effectiveParentEmail,
      studentAdmissionNumber.trim(),
      studentName ? studentName.trim() : null,
      relationship || 'PARENT'
    );

    // 2. Ensure user has a PENDING membership for this school
    const existingMem = db.prepare('SELECT id, status FROM school_memberships WHERE user_id = ? AND school_id = ?').get(userId, school.id) as any;
    if (!existingMem) {
      const memId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.prepare(`
        INSERT INTO school_memberships (id, user_id, school_id, role, status)
        VALUES (?, ?, ?, 'PARENT', 'PENDING')
      `).run(memId, userId, school.id);
    }

    db.exec('COMMIT;');

    return res.status(201).json({
      success: true,
      message: `Your registration request for ${school.name} has been submitted! Pending school administrator approval.`,
      requestId,
      schoolName: school.name,
    });
  } catch (err: any) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    console.error('[Parent Verification Request Error]', err);
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to submit verification request.' });
  }
});

// GET /api/v1/parents/verification-requests - Get status of verification requests for parent
parentRoutes.get('/verification-requests', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const requests = db
    .prepare(`
      SELECT pvr.*, s.name as school_name, s.code as school_code
      FROM parent_verification_requests pvr
      JOIN schools s ON pvr.school_id = s.id
      WHERE pvr.user_id = ?
      ORDER BY pvr.created_at DESC
    `)
    .all(userId);

  return res.json({ success: true, requests });
});

