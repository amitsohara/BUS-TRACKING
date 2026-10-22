import { Router, Response } from 'express';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, formatSafeServerError } from '../auth.ts';
import { broadcastTripLocation } from '../websocket.ts';

export const locationRoutes = Router();

// Helper: Haversine distance in meters
function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// POST /api/v1/trips/:tripId/locations - GPS Ingestion Endpoint for Drivers & Future Flutter App
locationRoutes.post(
  '/:tripId/locations',
  authenticate,
  requireSchoolContext(['DRIVER', 'TRANSPORT_MANAGER', 'SCHOOL_ADMIN', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant selected.' });
      }

      const { tripId } = req.params;
      const {
        latitude,
        longitude,
        speedKmh,
        heading,
        accuracyMeters,
        altitude,
        recordedAt,
      } = req.body;

      // 1. Validation
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_COORDINATES',
          message: 'Latitude and longitude are mandatory.',
        });
      }

      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({
          success: false,
          error: 'COORDINATES_OUT_OF_BOUNDS',
          message: 'Latitude must be between -90 and 90; longitude must be between -180 and 180.',
        });
      }

      // 2. Trip validation
      const trip = db
        .prepare('SELECT id, school_id, vehicle_id, driver_id, status FROM trips WHERE id = ? AND school_id = ?')
        .get(tripId, schoolId) as any;

      if (!trip) {
        return res.status(404).json({ success: false, error: 'TRIP_NOT_FOUND' });
      }

      if (trip.status !== 'IN_PROGRESS') {
        return res.status(400).json({
          success: false,
          error: 'TRIP_NOT_ACTIVE',
          message: `Cannot ingest GPS points for trip in "${trip.status}" state. Only IN_PROGRESS trips accept telemetry.`,
        });
      }

      const recordedTimestamp = recordedAt || new Date().toISOString();
      const locId = `loc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const speed = speedKmh !== undefined ? Math.max(0, parseFloat(speedKmh)) : 0;
      const hdg = heading !== undefined ? parseFloat(heading) : 0;
      const acc = accuracyMeters !== undefined ? parseFloat(accuracyMeters) : 5;

      // 3. Persist location record
      db.prepare(`
        INSERT INTO bus_locations (
          id, trip_id, vehicle_id, latitude, longitude, speed_kmh, heading,
          accuracy_meters, altitude, recorded_at, ingested_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        locId,
        tripId,
        trip.vehicle_id,
        lat,
        lng,
        speed,
        hdg,
        acc,
        altitude ? parseFloat(altitude) : null,
        recordedTimestamp
      );

      // 4. Automated Stop Geofence Checking:
      // If the bus is within stop's geofence radius (e.g. 60m), advance stop status to ARRIVED
      const pendingStops = db
        .prepare(`
          SELECT ts.id, ts.route_stop_id, ts.status, rs.stop_name, rs.latitude, rs.longitude, rs.geofence_radius_meters
          FROM trip_stops ts
          JOIN route_stops rs ON ts.route_stop_id = rs.id
          WHERE ts.trip_id = ? AND ts.status = 'PENDING'
          ORDER BY ts.stop_order ASC
          LIMIT 1
        `)
        .all(tripId) as any[];

      if (pendingStops.length > 0) {
        const nextStop = pendingStops[0];
        const distance = calculateDistanceMeters(lat, lng, nextStop.latitude, nextStop.longitude);
        const threshold = nextStop.geofence_radius_meters || 50;

        if (distance <= threshold) {
          db.prepare(`
            UPDATE trip_stops SET
              status = 'ARRIVED',
              arrived_at = datetime('now')
            WHERE id = ?
          `).run(nextStop.id);
        }
      }

      // 5. Broadcast to real-time subscribers
      const liveTelemetry = {
        id: locId,
        tripId,
        vehicleId: trip.vehicle_id,
        latitude: lat,
        longitude: lng,
        speedKmh: speed,
        heading: hdg,
        accuracyMeters: acc,
        recordedAt: recordedTimestamp,
      };

      broadcastTripLocation(tripId, liveTelemetry);

      return res.status(201).json({
        success: true,
        message: 'Location ingested and broadcast successfully',
        location: liveTelemetry,
      });
    } catch (err: any) {
      return formatSafeServerError(res, err, 'INGEST_GPS_LOCATION');
    }
  }
);

// POST /api/v1/trips/:tripId/locations/batch - Batch GPS Sync for Mobile Driver App Offline Reconnect
locationRoutes.post(
  '/:tripId/locations/batch',
  authenticate,
  requireSchoolContext(['DRIVER', 'TRANSPORT_MANAGER', 'SCHOOL_ADMIN', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant selected.' });
      }

      const { tripId } = req.params;
      const { points } = req.body;

      if (!Array.isArray(points) || points.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_PAYLOAD',
          message: 'points must be a non-empty array of coordinates.',
        });
      }

      const trip = db
        .prepare('SELECT id, school_id, vehicle_id, status FROM trips WHERE id = ? AND school_id = ?')
        .get(tripId, schoolId) as any;

      if (!trip) {
        return res.status(404).json({ success: false, error: 'TRIP_NOT_FOUND' });
      }

      if (trip.status !== 'IN_PROGRESS') {
        return res.status(400).json({
          success: false,
          error: 'TRIP_NOT_ACTIVE',
          message: 'Cannot ingest GPS points for non-active trips.',
        });
      }

      db.exec('BEGIN TRANSACTION;');
      try {
        const stmt = db.prepare(`
          INSERT INTO bus_locations (
            id, trip_id, vehicle_id, latitude, longitude, speed_kmh, heading,
            accuracy_meters, altitude, recorded_at, ingested_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `);

        let lastTelemetry: any = null;
        let validCount = 0;

        for (const p of points) {
          const lat = parseFloat(p.latitude);
          const lng = parseFloat(p.longitude);
          if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            continue;
          }

          const locId = `loc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const recordedTimestamp = p.recordedAt || new Date().toISOString();
          const speed = p.speedKmh !== undefined ? Math.max(0, parseFloat(p.speedKmh)) : 0;
          const hdg = p.heading !== undefined ? parseFloat(p.heading) : 0;
          const acc = p.accuracyMeters !== undefined ? parseFloat(p.accuracyMeters) : 5;

          stmt.run(
            locId,
            tripId,
            trip.vehicle_id,
            lat,
            lng,
            speed,
            hdg,
            acc,
            p.altitude ? parseFloat(p.altitude) : null,
            recordedTimestamp
          );

          lastTelemetry = {
            id: locId,
            tripId,
            vehicleId: trip.vehicle_id,
            latitude: lat,
            longitude: lng,
            speedKmh: speed,
            heading: hdg,
            accuracyMeters: acc,
            recordedAt: recordedTimestamp,
          };
          validCount++;
        }

        db.exec('COMMIT;');

        if (lastTelemetry) {
          broadcastTripLocation(tripId, lastTelemetry);
        }

        return res.status(201).json({
          success: true,
          message: `Successfully ingested ${validCount} GPS points.`,
          ingestedCount: validCount,
          latestLocation: lastTelemetry,
        });
      } catch (err: any) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        return formatSafeServerError(res, err, 'BATCH_GPS_INGEST');
      }
    } catch (outerErr: any) {
      return formatSafeServerError(res, outerErr, 'BATCH_GPS_INGEST_OUTER');
    }
  }
);

// GET /api/v1/trips/:tripId/locations/latest - Latest position & freshness
locationRoutes.get('/:tripId/locations/latest', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolContext?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant selected.' });
    }

    const { tripId } = req.params;

    const trip = db.prepare('SELECT id, status, vehicle_id FROM trips WHERE id = ? AND school_id = ?').get(tripId, schoolId) as any;
    if (!trip) {
      return res.status(404).json({ success: false, error: 'TRIP_NOT_FOUND' });
    }

    const latest = db
      .prepare('SELECT * FROM bus_locations WHERE trip_id = ? ORDER BY recorded_at DESC LIMIT 1')
      .get(tripId) as any;

    if (!latest) {
      return res.json({
        success: true,
        hasLocation: false,
        message: 'No GPS telemetry received for this trip yet.',
        tripStatus: trip.status,
      });
    }

    const recordedMillis = new Date(latest.recorded_at).getTime();
    const secondsAgo = Math.floor((Date.now() - recordedMillis) / 1000);
    const isStale = secondsAgo > 120;

    return res.json({
      success: true,
      hasLocation: true,
      location: latest,
      freshness: {
        secondsAgo,
        isStale,
        lastUpdated: latest.recorded_at,
      },
      tripStatus: trip.status,
    });
  } catch (err: any) {
    return formatSafeServerError(res, err, 'GET_LATEST_LOCATION');
  }
});

// GET /api/v1/trips/:tripId/locations/history - Breadcrumb trail
locationRoutes.get('/:tripId/locations/history', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolContext?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant selected.' });
    }

    const { tripId } = req.params;

    const trip = db.prepare('SELECT id FROM trips WHERE id = ? AND school_id = ?').get(tripId, schoolId);
    if (!trip) {
      return res.status(404).json({ success: false, error: 'TRIP_NOT_FOUND' });
    }

    const trail = db
      .prepare(`
        SELECT latitude, longitude, speed_kmh, heading, accuracy_meters, recorded_at
        FROM bus_locations
        WHERE trip_id = ?
        ORDER BY recorded_at ASC
        LIMIT 1000
      `)
      .all(tripId);

    return res.json({ success: true, count: trail.length, coordinates: trail });
  } catch (err: any) {
    return formatSafeServerError(res, err, 'GET_LOCATION_HISTORY');
  }
});
