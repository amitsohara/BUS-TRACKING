import { Router, Response } from 'express';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, logAudit } from '../auth.ts';

export const vehicleRoutes = Router();

// GET /api/v1/vehicles - List vehicles for current school
vehicleRoutes.get('/', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  const schoolId = req.schoolContext!.schoolId;
  const vehicles = db
    .prepare(`
      SELECT v.*,
        (SELECT COUNT(*) FROM routes r WHERE r.default_vehicle_id = v.id AND r.is_active = 1) as assigned_routes_count,
        (SELECT t.id FROM trips t WHERE t.vehicle_id = v.id AND t.status = 'IN_PROGRESS' LIMIT 1) as active_trip_id,
        (SELECT bl.recorded_at FROM bus_locations bl WHERE bl.vehicle_id = v.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_gps_at
      FROM vehicles v
      WHERE v.school_id = ?
      ORDER BY v.bus_number ASC
    `)
    .all(schoolId);

  return res.json({ success: true, vehicles });
});

// POST /api/v1/vehicles - Register vehicle
vehicleRoutes.post(
  '/',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext?.schoolId;
    if (!schoolId) {
      return res.status(400).json({
        success: false,
        error: 'NO_SCHOOL_CONTEXT',
        message: 'No school specified or selected. Please select a school first.',
      });
    }
    const {
      registrationNumber,
      busNumber,
      capacity,
      model,
      make,
      fuelType,
      fitnessExpiry,
      insuranceExpiry,
      gpsDeviceId,
    } = req.body;

    if (!registrationNumber || !busNumber || !capacity) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Registration number, internal bus number, and seating capacity are required',
      });
    }

    const regClean = registrationNumber.trim().toUpperCase();
    const existing = db
      .prepare('SELECT id FROM vehicles WHERE school_id = ? AND UPPER(registration_number) = ?')
      .get(schoolId, regClean);

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_REGISTRATION',
        message: `Vehicle with registration "${regClean}" is already registered in this school.`,
      });
    }

    const id = `veh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.prepare(`
      INSERT INTO vehicles (id, school_id, registration_number, bus_number, capacity, model, make, fuel_type, fitness_expiry, insurance_expiry, gps_device_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      id,
      schoolId,
      regClean,
      busNumber.trim(),
      parseInt(capacity, 10),
      model || 'Standard School Bus',
      make || 'Tata Motors',
      fuelType || 'CNG',
      fitnessExpiry || null,
      insuranceExpiry || null,
      gpsDeviceId || null
    );

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: 'CREATE_VEHICLE',
      entityType: 'VEHICLE',
      entityId: id,
      newValues: { registrationNumber: regClean, busNumber, capacity },
    });

    return res.status(201).json({ success: true, message: 'Vehicle added successfully', vehicleId: id });
  }
);

// PUT /api/v1/vehicles/:id - Update vehicle details or status
vehicleRoutes.put(
  '/:id',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
    const vehicleId = req.params.id;

    const existing = db.prepare('SELECT * FROM vehicles WHERE id = ? AND school_id = ?').get(vehicleId, schoolId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'VEHICLE_NOT_FOUND' });
    }

    const {
      busNumber,
      capacity,
      model,
      make,
      fuelType,
      fitnessExpiry,
      insuranceExpiry,
      gpsDeviceId,
      status,
    } = req.body;

    db.prepare(`
      UPDATE vehicles SET
        bus_number = COALESCE(?, bus_number),
        capacity = COALESCE(?, capacity),
        model = COALESCE(?, model),
        make = COALESCE(?, make),
        fuel_type = COALESCE(?, fuel_type),
        fitness_expiry = COALESCE(?, fitness_expiry),
        insurance_expiry = COALESCE(?, insurance_expiry),
        gps_device_id = COALESCE(?, gps_device_id),
        status = COALESCE(?, status),
        updated_at = datetime('now')
      WHERE id = ? AND school_id = ?
    `).run(
      busNumber,
      capacity ? parseInt(capacity, 10) : null,
      model,
      make,
      fuelType,
      fitnessExpiry,
      insuranceExpiry,
      gpsDeviceId,
      status,
      vehicleId,
      schoolId
    );

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: 'UPDATE_VEHICLE',
      entityType: 'VEHICLE',
      entityId: vehicleId,
      newValues: req.body,
    });

    return res.json({ success: true, message: 'Vehicle updated successfully' });
  }
);
