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
