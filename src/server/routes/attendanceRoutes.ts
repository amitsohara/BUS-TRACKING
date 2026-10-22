import { Router, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, logAudit, formatSafeServerError } from '../auth.ts';
import { broadcastAttendanceEvent } from '../websocket.ts';
import { dispatchNotification } from '../notificationService.ts';

export const attendanceRoutes = Router();

// Helper to notify parents truthfully
async function notifyParentsOfAttendance(schoolId: string, studentId: string, tripId: string, eventType: string, stopName: string) {
  try {
    const student = db.prepare('SELECT full_name FROM students WHERE id = ?').get(studentId) as any;
    const parents = db
      .prepare(`
        SELECT DISTINCT g.user_id
        FROM student_guardians sg
        JOIN guardians g ON sg.guardian_id = g.id
        WHERE sg.student_id = ? AND g.user_id IS NOT NULL
      `)
      .all(studentId) as any[];

    const studentName = student ? student.full_name : 'Your child';
    const title = eventType === 'BOARDING' ? 'Bus Boarding Confirmed' : 'Bus Drop-Off Confirmed';
    const message =
      eventType === 'BOARDING'
        ? `${studentName} has safely boarded the school bus at ${stopName}.`
        : `${studentName} has been safely dropped off at ${stopName}.`;

    for (const p of parents) {
      await dispatchNotification({
        schoolId,
        userId: p.user_id,
        title,
        message,
        notificationType: eventType,
        relatedTripId: tripId,
        relatedStudentId: studentId,
        channel: 'IN_APP',
      });
    }
  } catch (err) {
    console.error('[Notify Parents Error]', err);
  }
}

// POST /api/v1/trips/:tripId/attendance/scan - Scan Opaque QR Credential
attendanceRoutes.post(
  '/:tripId/attendance/scan',
  authenticate,
  requireSchoolContext(['DRIVER', 'ATTENDANT', 'TRANSPORT_MANAGER', 'SCHOOL_ADMIN', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant context selected.' });
      }
    const { tripId } = req.params;
    const { qrPayload, stopId, latitude, longitude, preferredEventType } = req.body;

    if (!qrPayload) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_QR_PAYLOAD',
        message: 'QR code payload string is required.',
      });
    }

    // 1. Verify Trip
    const trip = db.prepare('SELECT * FROM trips WHERE id = ? AND school_id = ?').get(tripId, schoolId) as any;
    if (!trip) {
      return res.status(404).json({ success: false, error: 'TRIP_NOT_FOUND' });
    }

    if (trip.status !== 'IN_PROGRESS') {
      return res.status(400).json({
        success: false,
        error: 'TRIP_NOT_ACTIVE',
        message: `Attendance can only be scanned during an IN_PROGRESS trip. (Current status: ${trip.status})`,
      });
    }

    // 2. Decode & Match Opaque QR Credential
    // Payload format: "SURAKSHA_VAHAN:qr_stu_01:HASH" or raw token "SVQR_..."
    let tokenHash = '';
    let qrId = '';

    if (qrPayload.startsWith('SURAKSHA_VAHAN:')) {
      const parts = qrPayload.split(':');
      qrId = parts[1];
      tokenHash = parts[2];
    } else {
      tokenHash = crypto.createHash('sha256').update(qrPayload.trim()).digest('hex');
    }

    let credential = db
      .prepare(`
        SELECT qc.*, s.full_name as student_name, s.admission_number, s.grade, s.section, s.emergency_phone
        FROM qr_credentials qc
        JOIN students s ON qc.student_id = s.id
        WHERE (qc.token_hash = ? OR qc.id = ?) AND qc.school_id = ?
      `)
      .get(tokenHash, qrId, schoolId) as any;

    if (!credential) {
      logAudit({
        schoolId,
        userId: req.user?.id,
        action: 'QR_SCAN_REJECTED',
        entityType: 'ATTENDANCE',
        newValues: { reason: 'UNRECOGNIZED_QR_TOKEN', rawInput: qrPayload.substring(0, 20) },
      });
      return res.status(404).json({
        success: false,
        error: 'INVALID_QR_BADGE',
        message: 'Unrecognized or unassigned QR badge. Student not found.',
      });
    }

    if (credential.is_revoked) {
      return res.status(403).json({
        success: false,
        error: 'REVOKED_QR_BADGE',
        message: `This student QR badge was revoked (${credential.revoked_reason || 'Lost card'}). Scan rejected.`,
      });
    }

    const studentId = credential.student_id;

    // 3. Verify Student Route Assignment
    const routeCol = trip.trip_type === 'EVENING_DROP' ? 'evening_route_id' : 'morning_route_id';
    const assignment = db
      .prepare(`SELECT * FROM transport_assignments WHERE student_id = ? AND ${routeCol} = ? AND is_active = 1`)
      .get(studentId, trip.route_id) as any;

    if (!assignment) {
      logAudit({
        schoolId,
        userId: req.user?.id,
        action: 'WRONG_BUS_SCAN_ALERT',
        entityType: 'ATTENDANCE',
        entityId: studentId,
        newValues: { tripId, studentId, studentName: credential.student_name },
      });
      return res.status(400).json({
        success: false,
        error: 'WRONG_BUS_ASSIGNMENT',
        message: `Safety Alert: ${credential.student_name} (${credential.admission_number}) is not assigned to this bus route (${trip.route_id}).`,
      });
    }

    // 4. Determine Event Type (Boarding vs Drop-off) & Duplicate Check
    const existingEvents = db
      .prepare(`
        SELECT event_type, scanned_at, id FROM attendance_events
        WHERE trip_id = ? AND student_id = ?
        ORDER BY scanned_at DESC
      `)
      .all(tripId, studentId) as any[];

    const hasBoarded = existingEvents.some((e) => e.event_type === 'BOARDING');
    const hasDropped = existingEvents.some((e) => e.event_type === 'DROP_OFF');

    let nextEventType: 'BOARDING' | 'DROP_OFF' = preferredEventType || (hasBoarded ? 'DROP_OFF' : 'BOARDING');

    if (nextEventType === 'BOARDING' && hasBoarded) {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_BOARDING',
        message: `${credential.student_name} was already boarded on this trip at ${existingEvents[0].scanned_at}.`,
      });
    }

    if (nextEventType === 'DROP_OFF' && !hasBoarded) {
      return res.status(409).json({
        success: false,
        error: 'DROP_OFF_WITHOUT_BOARDING',
        message: `Out-of-order scan: Cannot record drop-off for ${credential.student_name} because boarding was not previously recorded on this trip.`,
      });
    }

    if (nextEventType === 'DROP_OFF' && hasDropped) {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_DROP_OFF',
        message: `${credential.student_name} was already dropped off from this trip.`,
      });
    }

    // 5. Record Immutable Append-Only Attendance Event
    const eventId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const effectiveStopId =
      stopId ||
      (nextEventType === 'BOARDING' ? assignment.morning_stop_id : assignment.evening_stop_id);

    const stopRecord = effectiveStopId
      ? (db.prepare('SELECT stop_name FROM route_stops WHERE id = ?').get(effectiveStopId) as any)
      : null;
    const stopName = stopRecord ? stopRecord.stop_name : 'Designated Stop';

    db.prepare(`
      INSERT INTO attendance_events (
        id, school_id, trip_id, student_id, stop_id, event_type, scan_method,
        scanned_by_user_id, scanned_at, latitude, longitude, verification_status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'QR', ?, datetime('now'), ?, ?, 'VERIFIED')
    `).run(
      eventId,
      schoolId,
      tripId,
      studentId,
      effectiveStopId || null,
      nextEventType,
      req.user!.id,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null
    );

    // 6. Notify Parents & Broadcast
    notifyParentsOfAttendance(schoolId, studentId, tripId, nextEventType, stopName);

    const eventPayload = {
      id: eventId,
      tripId,
      studentId,
      studentName: credential.student_name,
      admissionNumber: credential.admission_number,
      grade: credential.grade,
      section: credential.section,
      eventType: nextEventType,
      scanMethod: 'QR',
      stopName,
      scannedAt: new Date().toISOString(),
    };

    broadcastAttendanceEvent(tripId, eventPayload);

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: `ATTENDANCE_${nextEventType}`,
      entityType: 'ATTENDANCE',
      entityId: eventId,
      newValues: eventPayload,
    });

    return res.status(201).json({
      success: true,
      message: `${nextEventType === 'BOARDING' ? 'Boarding' : 'Drop-off'} confirmed for ${credential.student_name}`,
      event: eventPayload,
    });
    } catch (err: any) {
      return formatSafeServerError(res, err, 'SCAN_ATTENDANCE');
    }
  }
);

// POST /api/v1/trips/:tripId/attendance/manual - Secure Manual Fallback for Damaged QR
attendanceRoutes.post(
  '/:tripId/attendance/manual',
  authenticate,
  requireSchoolContext(['DRIVER', 'ATTENDANT', 'TRANSPORT_MANAGER', 'SCHOOL_ADMIN', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant context selected.' });
      }
    const { tripId } = req.params;
    const { studentId, eventType, stopId, manualReason, latitude, longitude } = req.body;

    if (!studentId || !eventType || !manualReason) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Student ID, event type (BOARDING or DROP_OFF), and mandatory manual reason are required.',
      });
    }

    const trip = db.prepare('SELECT * FROM trips WHERE id = ? AND school_id = ?').get(tripId, schoolId) as any;
    if (!trip || trip.status !== 'IN_PROGRESS') {
      return res.status(400).json({ success: false, error: 'TRIP_NOT_ACTIVE' });
    }

    const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(studentId, schoolId) as any;
    if (!student) {
      return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND' });
    }

    const eventId = `att_man_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const stopRecord = stopId
      ? (db.prepare('SELECT stop_name FROM route_stops WHERE id = ?').get(stopId) as any)
      : null;
    const stopName = stopRecord ? stopRecord.stop_name : 'Manual Checkpoint';

    db.prepare(`
      INSERT INTO attendance_events (
        id, school_id, trip_id, student_id, stop_id, event_type, scan_method,
        scanned_by_user_id, scanned_at, latitude, longitude, manual_reason, verification_status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?, datetime('now'), ?, ?, ?, 'FLAGGED')
    `).run(
      eventId,
      schoolId,
      tripId,
      studentId,
      stopId || null,
      eventType,
      req.user!.id,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null,
      manualReason
    );

    notifyParentsOfAttendance(schoolId, studentId, tripId, eventType, stopName);

    const eventPayload = {
      id: eventId,
      tripId,
      studentId,
      studentName: student.full_name,
      admissionNumber: student.admission_number,
      grade: student.grade,
      section: student.section,
      eventType,
      scanMethod: 'MANUAL',
      manualReason,
      stopName,
      scannedAt: new Date().toISOString(),
    };

    broadcastAttendanceEvent(tripId, eventPayload);

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: `MANUAL_ATTENDANCE_${eventType}`,
      entityType: 'ATTENDANCE',
      newValues: eventPayload,
    });

    return res.status(201).json({
      success: true,
      message: `Manual ${eventType} logged for ${student.full_name}. Reason audited.`,
      event: eventPayload,
    });
    } catch (err: any) {
      return formatSafeServerError(res, err, 'MANUAL_ATTENDANCE');
    }
  }
);
