import { Router, Response } from 'express';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, logAudit, formatSafeServerError } from '../auth.ts';

export const routeRoutes = Router();

// GET /api/v1/routes - List routes for school
routeRoutes.get('/', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolContext?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No active school tenant selected.' });
    }

    const routes = db
      .prepare(`
        SELECT r.*,
          v.bus_number, v.registration_number, v.capacity as vehicle_capacity,
          d.full_name as driver_name, d.phone as driver_phone,
          (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = r.id) as stops_count,
          (SELECT COUNT(*) FROM transport_assignments ta WHERE (ta.morning_route_id = r.id OR ta.evening_route_id = r.id) AND ta.is_active = 1) as assigned_students_count
        FROM routes r
        LEFT JOIN vehicles v ON r.default_vehicle_id = v.id
        LEFT JOIN drivers d ON r.default_driver_id = d.id
        WHERE r.school_id = ?
        ORDER BY r.route_code ASC
      `)
      .all(schoolId);

    return res.json({ success: true, routes });
  } catch (err: any) {
    return formatSafeServerError(res, err, 'LIST_ROUTES');
  }
});

// GET /api/v1/routes/:id - Get route with all stops and assigned students
routeRoutes.get('/:id', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolContext?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No active school tenant selected.' });
    }

    const route = db
      .prepare(`
        SELECT r.*,
          v.bus_number, v.registration_number, v.capacity as vehicle_capacity,
          d.full_name as driver_name, d.phone as driver_phone
        FROM routes r
        LEFT JOIN vehicles v ON r.default_vehicle_id = v.id
        LEFT JOIN drivers d ON r.default_driver_id = d.id
        WHERE r.id = ? AND r.school_id = ?
      `)
      .get(req.params.id, schoolId) as any;

    if (!route) {
      return res.status(404).json({ success: false, error: 'ROUTE_NOT_FOUND' });
    }

    const stops = db
      .prepare(`
        SELECT rs.*,
          (SELECT COUNT(*) FROM transport_assignments ta WHERE (ta.morning_stop_id = rs.id OR ta.evening_stop_id = rs.id) AND ta.is_active = 1) as students_at_stop
        FROM route_stops rs
        WHERE rs.route_id = ?
        ORDER BY rs.sequence_order ASC
      `)
      .all(route.id);

    const students = db
      .prepare(`
        SELECT s.id, s.admission_number, s.full_name, s.grade, s.section, s.emergency_phone,
          ta.morning_stop_id, ta.evening_stop_id,
          rs1.stop_name as morning_stop_name, rs2.stop_name as evening_stop_name
        FROM transport_assignments ta
        JOIN students s ON ta.student_id = s.id
        LEFT JOIN route_stops rs1 ON ta.morning_stop_id = rs1.id
        LEFT JOIN route_stops rs2 ON ta.evening_stop_id = rs2.id
        WHERE (ta.morning_route_id = ? OR ta.evening_route_id = ?) AND ta.is_active = 1 AND s.school_id = ?
        ORDER BY s.grade ASC, s.full_name ASC
      `)
      .all(route.id, route.id, schoolId);

    return res.json({ success: true, route, stops, students });
  } catch (err: any) {
    return formatSafeServerError(res, err, 'GET_ROUTE_DETAIL');
  }
});

// POST /api/v1/routes - Create route with initial stops
routeRoutes.post(
  '/',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({
          success: false,
          error: 'NO_SCHOOL_CONTEXT',
          message: 'No school specified or selected. Please select a school first.',
        });
      }

      const {
        routeCode,
        name,
        description,
        morningStartTime,
        eveningStartTime,
        defaultVehicleId,
        defaultDriverId,
        stops,
      } = req.body;

      if (!routeCode || !name) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Route code and route name are required',
        });
      }

      const cleanCode = String(routeCode).trim().toUpperCase();
      const existing = db
        .prepare('SELECT id FROM routes WHERE school_id = ? AND UPPER(route_code) = ?')
        .get(schoolId, cleanCode);

      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'DUPLICATE_ROUTE_CODE',
          message: `Route with code "${cleanCode}" already exists.`,
        });
      }

      const routeId = `rt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare(`
          INSERT INTO routes (id, school_id, route_code, name, description, morning_start_time, evening_start_time, default_vehicle_id, default_driver_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          routeId,
          schoolId,
          cleanCode,
          String(name).trim(),
          description ? String(description).trim() : null,
          morningStartTime || '07:00',
          eveningStartTime || '14:30',
          defaultVehicleId || null,
          defaultDriverId || null
        );

        // Insert stops if provided
        if (Array.isArray(stops) && stops.length > 0) {
          stops.forEach((st: any, idx: number) => {
            const stopId = `stp_${routeId}_${idx + 1}`;
            db.prepare(`
              INSERT INTO route_stops (id, route_id, stop_name, landmark, latitude, longitude, sequence_order, morning_scheduled_time, evening_scheduled_time, geofence_radius_meters)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              stopId,
              routeId,
              st.stopName || `Stop ${idx + 1}`,
              st.landmark || null,
              parseFloat(st.latitude) || 28.6139,
              parseFloat(st.longitude) || 77.2090,
              idx + 1,
              st.morningScheduledTime || null,
              st.eveningScheduledTime || null,
              st.geofenceRadiusMeters || 50
            );
          });
        }

        db.exec('COMMIT;');

        logAudit({
          schoolId,
          userId: req.user?.id,
          action: 'CREATE_ROUTE',
          entityType: 'ROUTE',
          entityId: routeId,
          newValues: { routeCode: cleanCode, name, stopsCount: stops?.length || 0 },
        });

        return res.status(201).json({ success: true, message: 'Route created successfully', routeId });
      } catch (err: any) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        return formatSafeServerError(res, err, 'CREATE_ROUTE');
      }
    } catch (outerErr: any) {
      return formatSafeServerError(res, outerErr, 'CREATE_ROUTE_OUTER');
    }
  }
);

// POST /api/v1/routes/:id/stops - Add a stop to existing route
routeRoutes.post(
  '/:id/stops',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant selected.' });
      }

      const routeId = req.params.id;

      const route = db.prepare('SELECT id FROM routes WHERE id = ? AND school_id = ?').get(routeId, schoolId);
      if (!route) {
        return res.status(404).json({ success: false, error: 'ROUTE_NOT_FOUND' });
      }

      const {
        stopName,
        landmark,
        latitude,
        longitude,
        morningScheduledTime,
        eveningScheduledTime,
        geofenceRadiusMeters,
      } = req.body;

      if (!stopName || latitude === undefined || longitude === undefined) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Stop name, latitude, and longitude are required',
        });
      }

      const maxSeq = (
        db.prepare('SELECT MAX(sequence_order) as m FROM route_stops WHERE route_id = ?').get(routeId) as any
      )?.m || 0;
      const nextSeq = maxSeq + 1;
      const stopId = `stp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      db.prepare(`
        INSERT INTO route_stops (id, route_id, stop_name, landmark, latitude, longitude, sequence_order, morning_scheduled_time, evening_scheduled_time, geofence_radius_meters)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stopId,
        routeId,
        String(stopName).trim(),
        landmark ? String(landmark).trim() : null,
        parseFloat(latitude) || 28.6139,
        parseFloat(longitude) || 77.2090,
        nextSeq,
        morningScheduledTime || null,
        eveningScheduledTime || null,
        geofenceRadiusMeters || 50
      );

      return res.status(201).json({ success: true, message: 'Stop added to route', stopId, sequenceOrder: nextSeq });
    } catch (err: any) {
      return formatSafeServerError(res, err, 'ADD_ROUTE_STOP');
    }
  }
);

// PUT /api/v1/routes/:id - Update route details
routeRoutes.put(
  '/:id',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant selected.' });
      }

      const routeId = req.params.id;
      const existing = db.prepare('SELECT * FROM routes WHERE id = ? AND school_id = ?').get(routeId, schoolId);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'ROUTE_NOT_FOUND' });
      }

      const {
        routeCode,
        name,
        description,
        morningStartTime,
        eveningStartTime,
        defaultVehicleId,
        defaultDriverId,
        isActive,
      } = req.body;

      db.prepare(`
        UPDATE routes SET
          route_code = COALESCE(?, route_code),
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          morning_start_time = COALESCE(?, morning_start_time),
          evening_start_time = COALESCE(?, evening_start_time),
          default_vehicle_id = COALESCE(?, default_vehicle_id),
          default_driver_id = COALESCE(?, default_driver_id),
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
        WHERE id = ? AND school_id = ?
      `).run(
        routeCode ? String(routeCode).trim().toUpperCase() : null,
        name ? String(name).trim() : null,
        description ? String(description).trim() : null,
        morningStartTime || null,
        eveningStartTime || null,
        defaultVehicleId || null,
        defaultDriverId || null,
        isActive !== undefined ? (isActive ? 1 : 0) : null,
        routeId,
        schoolId
      );

      logAudit({
        schoolId,
        userId: req.user?.id,
        action: 'UPDATE_ROUTE',
        entityType: 'ROUTE',
        entityId: routeId,
        newValues: req.body,
      });

      return res.json({ success: true, message: 'Route updated successfully' });
    } catch (err: any) {
      return formatSafeServerError(res, err, 'UPDATE_ROUTE');
    }
  }
);
