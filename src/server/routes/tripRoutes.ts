import { Router, Response } from 'express';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, logAudit } from '../auth.ts';
import { broadcastTripStatusChange } from '../websocket.ts';
import { dispatchNotification } from '../notificationService.ts';

export const tripRoutes = Router();

// GET /api/v1/trips - List trips with status filters
tripRoutes.get('/', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  const schoolId = req.schoolContext!.schoolId;
  const status = req.query.status as string; // IN_PROGRESS, SCHEDULED, COMPLETED, CANCELLED
  const date = (req.query.date as string) || '';

  let query = `
    SELECT t.*,
      r.route_code, r.name as route_name,
      v.bus_number, v.registration_number,
      d.full_name as driver_name, d.phone as driver_phone,
      (SELECT COUNT(*) FROM trip_stops ts WHERE ts.trip_id = t.id) as total_stops,
      (SELECT COUNT(*) FROM trip_stops ts WHERE ts.trip_id = t.id AND ts.status = 'DEPARTED') as departed_stops,
      (SELECT COUNT(DISTINCT ae.student_id) FROM attendance_events ae WHERE ae.trip_id = t.id AND ae.event_type = 'BOARDING') as boarded_count,
      (SELECT COUNT(DISTINCT ae.student_id) FROM attendance_events ae WHERE ae.trip_id = t.id AND ae.event_type = 'DROP_OFF') as dropped_count,
      (SELECT bl.recorded_at FROM bus_locations bl WHERE bl.trip_id = t.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_gps_at,
      (SELECT bl.latitude FROM bus_locations bl WHERE bl.trip_id = t.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_lat,
      (SELECT bl.longitude FROM bus_locations bl WHERE bl.trip_id = t.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_lng,
      (SELECT bl.speed_kmh FROM bus_locations bl WHERE bl.trip_id = t.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_speed
    FROM trips t
    JOIN routes r ON t.route_id = r.id
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN drivers d ON t.driver_id = d.id
    WHERE t.school_id = ?
  `;
  const params: any[] = [schoolId];

  if (status) {
    query += ` AND t.status = ?`;
    params.push(status);
  }

  if (date) {
    query += ` AND t.trip_date = ?`;
    params.push(date);
  }

  query += ` ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'SCHEDULED' THEN 2 ELSE 3 END, t.created_at DESC`;

  const trips = db.prepare(query).all(...params);
  return res.json({ success: true, trips });
});

// GET /api/v1/trips/:id - Trip details, stop progress, passenger roster, and attendance
tripRoutes.get('/:id', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  const schoolId = req.schoolContext!.schoolId;
  const trip = db
    .prepare(`
      SELECT t.*,
        r.route_code, r.name as route_name, r.description as route_description,
        v.bus_number, v.registration_number, v.capacity as vehicle_capacity,
        d.full_name as driver_name, d.phone as driver_phone,
        u1.full_name as started_by_name,
        u2.full_name as completed_by_name
      FROM trips t
      JOIN routes r ON t.route_id = r.id
      JOIN vehicles v ON t.vehicle_id = v.id
      JOIN drivers d ON t.driver_id = d.id
      LEFT JOIN users u1 ON t.started_by_user_id = u1.id
      LEFT JOIN users u2 ON t.completed_by_user_id = u2.id
      WHERE t.id = ? AND t.school_id = ?
    `)
    .get(req.params.id, schoolId) as any;

  if (!trip) {
    return res.status(404).json({ success: false, error: 'TRIP_NOT_FOUND' });
  }

  // Trip stops with geofences and status
  const stops = db
    .prepare(`
      SELECT ts.*, rs.stop_name, rs.landmark, rs.latitude, rs.longitude, rs.morning_scheduled_time, rs.evening_scheduled_time, rs.geofence_radius_meters
      FROM trip_stops ts
      JOIN route_stops rs ON ts.route_stop_id = rs.id
      WHERE ts.trip_id = ?
      ORDER BY ts.stop_order ASC
    `)
    .all(trip.id);

  // Expected students for this route based on trip_type
  const stopIdColumn = trip.trip_type === 'EVENING_DROP' ? 'ta.evening_stop_id' : 'ta.morning_stop_id';
  const routeIdColumn = trip.trip_type === 'EVENING_DROP' ? 'ta.evening_route_id' : 'ta.morning_route_id';

  const expectedStudents = db
    .prepare(`
      SELECT s.id, s.admission_number, s.full_name, s.grade, s.section, s.emergency_phone,
        rs.id as assigned_stop_id, rs.stop_name as assigned_stop_name, rs.sequence_order as stop_sequence,
        (SELECT ae.event_type FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'BOARDING' LIMIT 1) as boarding_status,
        (SELECT ae.scanned_at FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'BOARDING' LIMIT 1) as boarded_at,
        (SELECT ae.scan_method FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'BOARDING' LIMIT 1) as boarding_method,
        (SELECT ae.event_type FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'DROP_OFF' LIMIT 1) as dropoff_status,
        (SELECT ae.scanned_at FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'DROP_OFF' LIMIT 1) as dropped_at
      FROM transport_assignments ta
      JOIN students s ON ta.student_id = s.id
      JOIN route_stops rs ON ${stopIdColumn} = rs.id
      WHERE ${routeIdColumn} = ? AND ta.is_active = 1 AND s.school_id = ?
      ORDER BY rs.sequence_order ASC, s.full_name ASC
    `)
    .all(trip.id, trip.id, trip.id, trip.id, trip.id, trip.route_id, schoolId);

  // Latest bus location
  const latestLocation = db
    .prepare('SELECT * FROM bus_locations WHERE trip_id = ? ORDER BY recorded_at DESC LIMIT 1')
    .get(trip.id);

  return res.json({
    success: true,
    trip,
    stops,
    expectedStudents,
    latestLocation,
  });
});

// POST /api/v1/trips - Schedule a new trip
tripRoutes.post(
  '/',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
    const {
      routeId,
      vehicleId,
      driverId,
      tripType, // MORNING_PICKUP, EVENING_DROP, SPECIAL
      tripDate, // YYYY-MM-DD
      scheduledStartTime, // HH:MM
      notes,
    } = req.body;

    if (!routeId || !vehicleId || !driverId || !tripType || !tripDate) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Route, vehicle, driver, trip type, and trip date are required',
      });
    }

    // Verify entities belong to current school
    const route = db.prepare('SELECT id FROM routes WHERE id = ? AND school_id = ?').get(routeId, schoolId);
    const vehicle = db.prepare('SELECT id FROM vehicles WHERE id = ? AND school_id = ?').get(vehicleId, schoolId);
    const driver = db.prepare('SELECT id FROM drivers WHERE id = ? AND school_id = ?').get(driverId, schoolId);

    if (!route || !vehicle || !driver) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_RESOURCE',
        message: 'Route, vehicle, or driver not found or does not belong to this school.',
      });
    }

    const tripId = `trip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO trips (
          id, school_id, route_id, vehicle_id, driver_id, trip_type, trip_date,
          scheduled_start_time, status, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?)
      `).run(
        tripId,
        schoolId,
        routeId,
        vehicleId,
        driverId,
        tripType,
        tripDate,
        scheduledStartTime || '07:00',
        notes || null
      );

      // Populate trip stops from route stops
      const routeStops = db
        .prepare('SELECT id, sequence_order FROM route_stops WHERE route_id = ? ORDER BY sequence_order ASC')
        .all(routeId) as any[];

      routeStops.forEach((rs) => {
        db.prepare(`
          INSERT INTO trip_stops (id, trip_id, route_stop_id, stop_order, status)
          VALUES (?, ?, ?, ?, 'PENDING')
        `).run(`ts_${tripId}_${rs.sequence_order}`, tripId, rs.id, rs.sequence_order);
      });

      db.exec('COMMIT;');

      logAudit({
        schoolId,
        userId: req.user?.id,
        action: 'SCHEDULE_TRIP',
        entityType: 'TRIP',
        entityId: tripId,
        newValues: { routeId, vehicleId, driverId, tripType, tripDate },
      });

      return res.status(201).json({ success: true, message: 'Trip scheduled successfully', tripId });
    } catch (err: any) {
      db.exec('ROLLBACK;');
      return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }
);

// POST /api/v1/trips/:id/start - Transition SCHEDULED → IN_PROGRESS
tripRoutes.post(
  '/:id/start',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'DRIVER', 'PLATFORM_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
    const tripId = req.params.id;

    const trip = db.prepare('SELECT * FROM trips WHERE id = ? AND school_id = ?').get(tripId, schoolId) as any;
    if (!trip) {
      return res.status(404).json({ success: false, error: 'TRIP_NOT_FOUND' });
    }

    if (trip.status !== 'SCHEDULED') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TRANSITION',
        message: `Cannot start trip with status "${trip.status}". Allowed transition only from SCHEDULED.`,
      });
    }

    // Check conflict: Is the same vehicle or driver already in an IN_PROGRESS trip?
    const conflictingVehicle = db
      .prepare("SELECT id FROM trips WHERE vehicle_id = ? AND status = 'IN_PROGRESS' AND id != ?")
      .get(trip.vehicle_id, tripId) as any;

    if (conflictingVehicle) {
      return res.status(409).json({
        success: false,
        error: 'VEHICLE_BUSY',
        message: `This vehicle is currently running in active trip #${conflictingVehicle.id}. Please complete that trip first.`,
      });
    }

    const conflictingDriver = db
      .prepare("SELECT id FROM trips WHERE driver_id = ? AND status = 'IN_PROGRESS' AND id != ?")
      .get(trip.driver_id, tripId) as any;

    if (conflictingDriver) {
      return res.status(409).json({
        success: false,
        error: 'DRIVER_BUSY',
        message: `This driver is currently operating active trip #${conflictingDriver.id}.`,
      });
    }

    db.prepare(`
      UPDATE trips SET
        status = 'IN_PROGRESS',
        actual_start_time = datetime('now'),
        started_by_user_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user!.id, tripId);

    // Notify parents of students assigned to this route
    const stopColumn = trip.trip_type === 'EVENING_DROP' ? 'evening_route_id' : 'morning_route_id';
    const parents = db
      .prepare(`
        SELECT DISTINCT g.user_id, s.full_name as student_name
        FROM transport_assignments ta
        JOIN students s ON ta.student_id = s.id
        JOIN student_guardians sg ON s.id = sg.student_id
        JOIN guardians g ON sg.guardian_id = g.id
        WHERE ta.${stopColumn} = ? AND ta.is_active = 1 AND g.user_id IS NOT NULL
      `)
      .all(trip.route_id) as any[];

    for (const p of parents) {
      await dispatchNotification({
        schoolId,
        userId: p.user_id,
        title: 'School Bus Trip Started',
        message: `The school bus for ${p.student_name} has started its journey.`,
        notificationType: 'TRIP_STARTED',
        relatedTripId: tripId,
        channel: 'IN_APP',
      });
    }

    broadcastTripStatusChange(tripId, 'IN_PROGRESS', { actualStartTime: new Date().toISOString() });

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: 'START_TRIP',
      entityType: 'TRIP',
      entityId: tripId,
    });

    return res.json({ success: true, message: 'Trip started successfully. Live tracking is active.' });
  }
);

// POST /api/v1/trips/:id/complete - Transition IN_PROGRESS → COMPLETED with mandatory reconciliation
tripRoutes.post(
  '/:id/complete',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'DRIVER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
    const tripId = req.params.id;
    const { physicalCheckConfirmed, reconciliationNotes } = req.body;

    const trip = db.prepare('SELECT * FROM trips WHERE id = ? AND school_id = ?').get(tripId, schoolId) as any;
    if (!trip) {
      return res.status(404).json({ success: false, error: 'TRIP_NOT_FOUND' });
    }

    if (trip.status !== 'IN_PROGRESS') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TRANSITION',
        message: `Cannot complete trip with status "${trip.status}". Trip must be IN_PROGRESS.`,
      });
    }

    // Safety constraint: Physical check acknowledgment
    if (!physicalCheckConfirmed) {
      return res.status(400).json({
        success: false,
        error: 'PHYSICAL_CHECK_REQUIRED',
        message: 'Driver or attendant must confirm that the physical safety check inside the bus has been completed.',
      });
    }

    // Check trip end reconciliation:
    // Look for any student boarded without a recorded drop-off
    const missingDropoffs = db
      .prepare(`
        SELECT s.id, s.full_name, s.admission_number, s.grade, s.section, s.emergency_phone
        FROM attendance_events ae
        JOIN students s ON ae.student_id = s.id
        WHERE ae.trip_id = ? AND ae.event_type = 'BOARDING'
        AND NOT EXISTS (
          SELECT 1 FROM attendance_events ae2
          WHERE ae2.trip_id = ae.trip_id AND ae2.student_id = ae.student_id AND ae2.event_type = 'DROP_OFF'
        )
      `)
      .all(tripId) as any[];

    // If tenant enforces strict reconciliation and there are missing dropoffs
    const tenantSettings = db.prepare('SELECT strict_reconciliation_required FROM tenant_settings WHERE school_id = ?').get(schoolId) as any;
    if (tenantSettings?.strict_reconciliation_required && missingDropoffs.length > 0 && !reconciliationNotes) {
      return res.status(422).json({
        success: false,
        error: 'RECONCILIATION_EXCEPTION',
        message: `${missingDropoffs.length} student(s) boarded this bus but do not have a recorded drop-off. Please review the reconciliation roster or provide mandatory resolution notes.`,
        unaccountedStudents: missingDropoffs,
      });
    }

    db.prepare(`
      UPDATE trips SET
        status = 'COMPLETED',
        actual_end_time = datetime('now'),
        completed_by_user_id = ?,
        notes = COALESCE(?, notes),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user!.id, reconciliationNotes || null, tripId);

    broadcastTripStatusChange(tripId, 'COMPLETED', {
      actualEndTime: new Date().toISOString(),
      missingDropoffsCount: missingDropoffs.length,
    });

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: 'COMPLETE_TRIP',
      entityType: 'TRIP',
      entityId: tripId,
      newValues: {
        physicalCheckConfirmed: true,
        reconciliationNotes,
        missingDropoffsCount: missingDropoffs.length,
      },
    });

    return res.json({
      success: true,
      message: 'Trip completed successfully. Physical safety inspection and reconciliation verified.',
      unaccountedStudentsCount: missingDropoffs.length,
    });
  }
);

// POST /api/v1/trips/:id/cancel - Cancel a trip
tripRoutes.post(
  '/:id/cancel',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
    const tripId = req.params.id;
    const { reason } = req.body;

    const trip = db.prepare('SELECT * FROM trips WHERE id = ? AND school_id = ?').get(tripId, schoolId) as any;
    if (!trip) {
      return res.status(404).json({ success: false, error: 'TRIP_NOT_FOUND' });
    }

    if (trip.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: 'CANNOT_CANCEL_COMPLETED',
        message: 'Completed trips cannot be cancelled.',
      });
    }

    db.prepare(`
      UPDATE trips SET
        status = 'CANCELLED',
        cancellation_reason = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(reason || 'Cancelled by administration', tripId);

    broadcastTripStatusChange(tripId, 'CANCELLED', { reason });

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: 'CANCEL_TRIP',
      entityType: 'TRIP',
      entityId: tripId,
      newValues: { reason },
    });

    return res.json({ success: true, message: 'Trip marked as cancelled.' });
  }
);
