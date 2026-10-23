import { Router, Response } from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, logAudit, formatSafeServerError, hashPassword } from '../auth.ts';

export const studentRoutes = Router();

// GET /api/v1/students - List students for current school
studentRoutes.get('/', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolContext?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No active school tenant selected.' });
    }

    const search = ((req.query.search as string) || '').trim();
    const grade = ((req.query.grade as string) || '').trim();
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
    const offset = (page - 1) * limit;

    let query = `
      SELECT s.*, 
        ta.morning_route_id, ta.morning_stop_id, ta.evening_route_id, ta.evening_stop_id,
        r1.name as morning_route_name, r1.route_code as morning_route_code,
        rs1.stop_name as morning_stop_name,
        r2.name as evening_route_name, r2.route_code as evening_route_code,
        rs2.stop_name as evening_stop_name,
        qc.id as qr_id, qc.token_hint, qc.is_revoked as qr_revoked
      FROM students s
      LEFT JOIN transport_assignments ta ON s.id = ta.student_id AND ta.is_active = 1
      LEFT JOIN routes r1 ON ta.morning_route_id = r1.id
      LEFT JOIN route_stops rs1 ON ta.morning_stop_id = rs1.id
      LEFT JOIN routes r2 ON ta.evening_route_id = r2.id
      LEFT JOIN route_stops rs2 ON ta.evening_stop_id = rs2.id
      LEFT JOIN qr_credentials qc ON s.id = qc.student_id AND qc.is_revoked = 0
      WHERE s.school_id = ?
    `;
    const params: any[] = [schoolId];

    if (search) {
      query += ` AND (LOWER(s.full_name) LIKE ? OR LOWER(s.admission_number) LIKE ? OR s.emergency_phone LIKE ?)`;
      const searchPattern = `%${search.toLowerCase()}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (grade) {
      query += ` AND s.grade = ?`;
      params.push(grade);
    }

    // Count total for pagination
    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM (${query})`)
      .get(...params) as { total: number };

    query += ` ORDER BY s.grade ASC, s.section ASC, s.full_name ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const students = db.prepare(query).all(...params);

    return res.json({
      success: true,
      students,
      pagination: {
        page,
        limit,
        total: countRow ? countRow.total : 0,
        totalPages: Math.ceil((countRow ? countRow.total : 0) / limit),
      },
    });
  } catch (err: any) {
    return formatSafeServerError(res, err, 'LIST_STUDENTS');
  }
});

// GET /api/v1/students/:id - Detail view with guardians and attendance history
studentRoutes.get('/:id', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolContext?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No active school tenant selected.' });
    }

    const student = db
      .prepare(`
        SELECT s.*, 
          ta.morning_route_id, ta.morning_stop_id, ta.evening_route_id, ta.evening_stop_id,
          r1.name as morning_route_name, r1.route_code as morning_route_code,
          rs1.stop_name as morning_stop_name, rs1.morning_scheduled_time,
          r2.name as evening_route_name, r2.route_code as evening_stop_code,
          rs2.stop_name as evening_stop_name, rs2.evening_scheduled_time
        FROM students s
        LEFT JOIN transport_assignments ta ON s.id = ta.student_id AND ta.is_active = 1
        LEFT JOIN routes r1 ON ta.morning_route_id = r1.id
        LEFT JOIN route_stops rs1 ON ta.morning_stop_id = rs1.id
        LEFT JOIN routes r2 ON ta.evening_route_id = r2.id
        LEFT JOIN route_stops rs2 ON ta.evening_stop_id = rs2.id
        WHERE s.id = ? AND s.school_id = ?
      `)
      .get(req.params.id, schoolId) as any;

    if (!student) {
      return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND' });
    }

    // Guardians
    const guardians = db
      .prepare(`
        SELECT g.*, sg.is_primary, sg.can_pickup, sg.relationship_type
        FROM student_guardians sg
        JOIN guardians g ON sg.guardian_id = g.id
        WHERE sg.student_id = ?
      `)
      .all(student.id);

    // Active QR credential
    const qrCredential = db
      .prepare('SELECT id, token_hint, issued_at, expires_at, is_revoked FROM qr_credentials WHERE student_id = ? AND is_revoked = 0')
      .get(student.id);

    // Recent attendance events (last 10)
    const recentAttendance = db
      .prepare(`
        SELECT ae.*, r.name as route_name, rs.stop_name, u.full_name as scanned_by_name
        FROM attendance_events ae
        JOIN trips t ON ae.trip_id = t.id
        JOIN routes r ON t.route_id = r.id
        LEFT JOIN route_stops rs ON ae.stop_id = rs.id
        LEFT JOIN users u ON ae.scanned_by_user_id = u.id
        WHERE ae.student_id = ? AND ae.school_id = ?
        ORDER BY ae.scanned_at DESC
        LIMIT 10
      `)
      .all(student.id, schoolId);

    return res.json({
      success: true,
      student,
      guardians,
      qrCredential,
      recentAttendance,
    });
  } catch (err: any) {
    return formatSafeServerError(res, err, 'GET_STUDENT_DETAIL');
  }
});

// POST /api/v1/students - Create new student
studentRoutes.post(
  '/',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  async (req: AuthRequest, res: Response) => {
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
        admissionNumber,
        fullName,
        grade,
        section,
        bloodGroup,
        emergencyPhone,
        homeAddress,
        morningRouteId,
        morningStopId,
        eveningRouteId,
        eveningStopId,
        // Optional Parent/Guardian fields
        parentName,
        parentPhone,
        parentEmail,
        parentRelationship,
        parentPassword,
      } = req.body;

      if (!admissionNumber || !fullName || !grade || !section || !emergencyPhone) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Admission number, full name, grade, section, and emergency contact phone are required',
        });
      }

      const cleanAdm = String(admissionNumber).trim();
      const existing = db
        .prepare('SELECT id FROM students WHERE school_id = ? AND LOWER(admission_number) = LOWER(?)')
        .get(schoolId, cleanAdm);

      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'ADMISSION_EXISTS',
          message: `Student with admission number "${cleanAdm}" already exists in this school.`,
        });
      }

      const studentId = `stu_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare(`
          INSERT INTO students (id, school_id, admission_number, full_name, grade, section, blood_group, emergency_phone, home_address, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
        `).run(
          studentId,
          schoolId,
          cleanAdm.toUpperCase(),
          String(fullName).trim(),
          String(grade).trim(),
          String(section).trim().toUpperCase(),
          bloodGroup ? String(bloodGroup).trim() : 'O+',
          String(emergencyPhone).trim(),
          homeAddress ? String(homeAddress).trim() : null
        );

        // Transport assignment if provided
        if (morningRouteId || eveningRouteId) {
          let effMorningStop = morningStopId || null;
          let effEveningStop = eveningStopId || null;

          if (morningRouteId && !effMorningStop) {
            const firstStop = db.prepare('SELECT id FROM route_stops WHERE route_id = ? ORDER BY sequence_order ASC LIMIT 1').get(morningRouteId) as any;
            if (firstStop) effMorningStop = firstStop.id;
          }

          if (eveningRouteId && !effEveningStop) {
            const firstStop = db.prepare('SELECT id FROM route_stops WHERE route_id = ? ORDER BY sequence_order ASC LIMIT 1').get(eveningRouteId) as any;
            if (firstStop) effEveningStop = firstStop.id;
          }

          db.prepare(`
            INSERT INTO transport_assignments (id, school_id, student_id, morning_route_id, morning_stop_id, evening_route_id, evening_stop_id, academic_year, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, '2026-2027', 1)
          `).run(
            `ta_${studentId}`,
            schoolId,
            studentId,
            morningRouteId || null,
            effMorningStop,
            eveningRouteId || null,
            effEveningStop
          );
        }

        // Automatically issue cryptographic QR credential
        const rawToken = `SVQR_${crypto.randomBytes(24).toString('hex')}`;
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const tokenHint = `SV-QR-${rawToken.substring(5, 9).toUpperCase()}`;

        db.prepare(`
          INSERT INTO qr_credentials (id, school_id, student_id, token_hash, token_hint, expires_at, is_revoked)
          VALUES (?, ?, ?, ?, ?, date('now', '+1 year'), 0)
        `).run(`qr_${studentId}`, schoolId, studentId, tokenHash, tokenHint);

        // Optional Parent/Guardian registration during student creation
        if (parentName && parentPhone) {
          const cleanPName = String(parentName).trim();
          const cleanPPhone = String(parentPhone).trim();
          const cleanPEmail = parentEmail ? String(parentEmail).trim().toLowerCase() : null;
          const relType = parentRelationship ? String(parentRelationship).trim().toUpperCase() : 'PARENT';

          let parentUserId: string | null = null;

          if (cleanPEmail) {
            const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(cleanPEmail) as any;
            if (existingUser) {
              parentUserId = existingUser.id;
              // Ensure school membership exists
              db.prepare(`
                INSERT INTO school_memberships (id, user_id, school_id, role, status)
                VALUES (?, ?, ?, 'PARENT', 'ACTIVE')
                ON CONFLICT(user_id, school_id) DO UPDATE SET status = 'ACTIVE'
              `).run(`mem_par_${parentUserId}_${schoolId}`, parentUserId, schoolId);
            } else if (parentPassword && String(parentPassword).trim().length >= 6) {
              parentUserId = `usr_par_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
              const hashedPw = await hashPassword(String(parentPassword).trim());

              db.prepare(`
                INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
                VALUES (?, ?, ?, ?, ?, 'USER', 1)
              `).run(parentUserId, cleanPEmail, hashedPw, cleanPName, cleanPPhone);

              db.prepare(`
                INSERT INTO school_memberships (id, user_id, school_id, role, status)
                VALUES (?, ?, ?, 'PARENT', 'ACTIVE')
              `).run(`mem_${parentUserId}`, parentUserId, schoolId);
            }
          }

          let guardianId = `gdn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

          // Check if guardian already exists
          const existingGuardian = db.prepare(`
            SELECT id FROM guardians WHERE (user_id IS NOT NULL AND user_id = ?) OR (phone = ? AND full_name = ?)
          `).get(parentUserId, cleanPPhone, cleanPName) as any;

          if (existingGuardian) {
            guardianId = existingGuardian.id;
          } else {
            db.prepare(`
              INSERT INTO guardians (id, user_id, full_name, phone, email, relationship)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(guardianId, parentUserId, cleanPName, cleanPPhone, cleanPEmail, relType);
          }

          db.prepare(`
            INSERT INTO student_guardians (id, student_id, guardian_id, is_primary, can_pickup, relationship_type)
            VALUES (?, ?, ?, 1, 1, ?)
            ON CONFLICT(student_id, guardian_id) DO UPDATE SET is_primary = 1
          `).run(`sg_${studentId}_${guardianId}`, studentId, guardianId, relType);
        }

        db.exec('COMMIT;');

        logAudit({
          schoolId,
          userId: req.user?.id,
          action: 'CREATE_STUDENT',
          entityType: 'STUDENT',
          entityId: studentId,
          newValues: { admissionNumber: cleanAdm, fullName, grade, section },
        });

        return res.status(201).json({
          success: true,
          message: 'Student registered successfully with transport and QR badge.',
          studentId,
        });
      } catch (err: any) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        return formatSafeServerError(res, err, 'CREATE_STUDENT');
      }
    } catch (outerErr: any) {
      return formatSafeServerError(res, outerErr, 'CREATE_STUDENT_OUTER');
    }
  }
);

// POST /api/v1/students/:id/guardians - Register / Link parent or guardian to student
studentRoutes.post(
  '/:id/guardians',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant selected.' });
      }

      const studentId = req.params.id;
      const student = db.prepare('SELECT id, full_name FROM students WHERE id = ? AND school_id = ?').get(studentId, schoolId) as any;
      if (!student) {
        return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND', message: 'Student not found in active school.' });
      }

      const {
        fullName,
        phone,
        email,
        relationship,
        password,
        isPrimary = true,
        canPickup = true,
        occupation,
        address,
      } = req.body;

      if (!fullName || !phone) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Parent/Guardian full name and phone number are required.',
        });
      }

      const cleanName = String(fullName).trim();
      const cleanPhone = String(phone).trim();
      const cleanEmail = email ? String(email).trim().toLowerCase() : null;
      const relType = relationship ? String(relationship).trim().toUpperCase() : 'PARENT';

      db.exec('BEGIN TRANSACTION;');
      try {
        let parentUserId: string | null = null;

        if (cleanEmail) {
          const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(cleanEmail) as any;
          if (existingUser) {
            parentUserId = existingUser.id;
            // Ensure school membership exists
            db.prepare(`
              INSERT INTO school_memberships (id, user_id, school_id, role, status)
              VALUES (?, ?, ?, 'PARENT', 'ACTIVE')
              ON CONFLICT(user_id, school_id) DO UPDATE SET status = 'ACTIVE'
            `).run(`mem_par_${parentUserId}_${schoolId}`, parentUserId, schoolId);
          } else if (password && String(password).trim().length >= 6) {
            parentUserId = `usr_par_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            const hashedPw = await hashPassword(String(password).trim());

            db.prepare(`
              INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
              VALUES (?, ?, ?, ?, ?, 'USER', 1)
            `).run(parentUserId, cleanEmail, hashedPw, cleanName, cleanPhone);

            db.prepare(`
              INSERT INTO school_memberships (id, user_id, school_id, role, status)
              VALUES (?, ?, ?, 'PARENT', 'ACTIVE')
            `).run(`mem_${parentUserId}`, parentUserId, schoolId);
          }
        }

        let guardianId = `gdn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

        const existingGuardian = db.prepare(`
          SELECT id FROM guardians WHERE (user_id IS NOT NULL AND user_id = ?) OR (phone = ? AND full_name = ?)
        `).get(parentUserId, cleanPhone, cleanName) as any;

        if (existingGuardian) {
          guardianId = existingGuardian.id;
        } else {
          db.prepare(`
            INSERT INTO guardians (id, user_id, full_name, phone, email, relationship, occupation, address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            guardianId,
            parentUserId,
            cleanName,
            cleanPhone,
            cleanEmail,
            relType,
            occupation ? String(occupation).trim() : null,
            address ? String(address).trim() : null
          );
        }

        db.prepare(`
          INSERT INTO student_guardians (id, student_id, guardian_id, is_primary, can_pickup, relationship_type)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(student_id, guardian_id) DO UPDATE SET
            is_primary = excluded.is_primary,
            can_pickup = excluded.can_pickup,
            relationship_type = excluded.relationship_type
        `).run(`sg_${studentId}_${guardianId}`, studentId, guardianId, isPrimary ? 1 : 0, canPickup ? 1 : 0, relType);

        db.exec('COMMIT;');

        logAudit({
          schoolId,
          userId: req.user?.id,
          action: 'ADD_STUDENT_GUARDIAN',
          entityType: 'STUDENT',
          entityId: studentId,
          newValues: { guardianId, fullName: cleanName, relationship: relType },
        });

        return res.status(201).json({
          success: true,
          message: `Parent / Guardian "${cleanName}" linked successfully to student ${student.full_name}.`,
          guardianId,
        });
      } catch (err: any) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        return formatSafeServerError(res, err, 'ADD_STUDENT_GUARDIAN');
      }
    } catch (outerErr: any) {
      return formatSafeServerError(res, outerErr, 'ADD_STUDENT_GUARDIAN_OUTER');
    }
  }
);

// PUT /api/v1/students/:id - Update student
studentRoutes.put(
  '/:id',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant selected.' });
      }

      const studentId = req.params.id;

      const existing = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(studentId, schoolId) as any;
      if (!existing) {
        return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND' });
      }

      const {
        fullName,
        grade,
        section,
        bloodGroup,
        emergencyPhone,
        homeAddress,
        status,
        morningRouteId,
        morningStopId,
        eveningRouteId,
        eveningStopId,
      } = req.body;

      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare(`
          UPDATE students SET
            full_name = COALESCE(?, full_name),
            grade = COALESCE(?, grade),
            section = COALESCE(?, section),
            blood_group = COALESCE(?, blood_group),
            emergency_phone = COALESCE(?, emergency_phone),
            home_address = COALESCE(?, home_address),
            status = COALESCE(?, status),
            updated_at = datetime('now')
          WHERE id = ? AND school_id = ?
        `).run(
          fullName ? String(fullName).trim() : null,
          grade ? String(grade).trim() : null,
          section ? String(section).trim().toUpperCase() : null,
          bloodGroup ? String(bloodGroup).trim() : null,
          emergencyPhone ? String(emergencyPhone).trim() : null,
          homeAddress ? String(homeAddress).trim() : null,
          status ? String(status).trim() : null,
          studentId,
          schoolId
        );

        // Upsert transport assignment
        if (morningRouteId !== undefined || eveningRouteId !== undefined) {
          db.prepare(`
            INSERT INTO transport_assignments (id, school_id, student_id, morning_route_id, morning_stop_id, evening_route_id, evening_stop_id, academic_year, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, '2026-2027', 1)
            ON CONFLICT(student_id, academic_year) DO UPDATE SET
              morning_route_id = excluded.morning_route_id,
              morning_stop_id = excluded.morning_stop_id,
              evening_route_id = excluded.evening_route_id,
              evening_stop_id = excluded.evening_stop_id,
              updated_at = datetime('now')
          `).run(
            `ta_${studentId}`,
            schoolId,
            studentId,
            morningRouteId || null,
            morningStopId || null,
            eveningRouteId || null,
            eveningStopId || null
          );
        }

        db.exec('COMMIT;');

        logAudit({
          schoolId,
          userId: req.user?.id,
          action: 'UPDATE_STUDENT',
          entityType: 'STUDENT',
          entityId: studentId,
          oldValues: existing,
          newValues: req.body,
        });

        return res.json({ success: true, message: 'Student updated successfully' });
      } catch (err: any) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        return formatSafeServerError(res, err, 'UPDATE_STUDENT');
      }
    } catch (outerErr: any) {
      return formatSafeServerError(res, outerErr, 'UPDATE_STUDENT_OUTER');
    }
  }
);

// GET /api/v1/students/:id/qr-badge - Get QR Badge info and printable QR payload
studentRoutes.get('/:id/qr-badge', authenticate, requireSchoolContext(), async (req: AuthRequest, res: Response) => {
  try {
    const schoolId = req.schoolContext?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No active school tenant selected.' });
    }

    const studentId = req.params.id;

    // Privacy verification: If requester is PARENT, verify that this student is their child
    if (req.schoolContext?.role === 'PARENT') {
      const isLinked = db
        .prepare(`
          SELECT 1 FROM student_guardians sg
          JOIN guardians g ON sg.guardian_id = g.id
          WHERE sg.student_id = ? AND g.user_id = ?
        `)
        .get(studentId, req.user!.id);

      if (!isLinked) {
        return res.status(403).json({
          success: false,
          error: 'ACCESS_DENIED',
          message: 'DPDP Privacy Protection: You are only authorized to view QR badges for your own registered children.',
        });
      }
    }

    const student = db
      .prepare('SELECT id, full_name, admission_number, grade, section, emergency_phone FROM students WHERE id = ? AND school_id = ?')
      .get(studentId, schoolId) as any;

    if (!student) {
      return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND' });
    }

    // Look up active QR credential or issue a new one
    let credential = db
      .prepare('SELECT id, token_hash, token_hint, expires_at, is_revoked FROM qr_credentials WHERE student_id = ? AND is_revoked = 0')
      .get(student.id) as any;

    let rawToken = '';
    if (!credential) {
      rawToken = `SVQR_${crypto.randomBytes(24).toString('hex')}`;
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const tokenHint = `SV-QR-${rawToken.substring(5, 9).toUpperCase()}`;

      credential = {
        id: `qr_${student.id}`,
        token_hash: tokenHash,
        token_hint: tokenHint,
        expires_at: '2027-03-31',
        is_revoked: 0,
      };

      db.prepare(`
        INSERT INTO qr_credentials (id, school_id, student_id, token_hash, token_hint, expires_at, is_revoked)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(credential.id, schoolId, student.id, tokenHash, tokenHint, credential.expires_at);
    } else {
      rawToken = `SURAKSHA_VAHAN:${credential.id}:${credential.token_hash}`;
    }

    const qrPayload = rawToken || `SURAKSHA_VAHAN:${credential.id}:${credential.token_hash}`;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 280,
      margin: 2,
      color: {
        dark: '#1e293b',
        light: '#ffffff',
      },
    });

    return res.json({
      success: true,
      student,
      qrDataUrl,
      qrPayload,
      credential: {
        id: credential.id,
        tokenHint: credential.token_hint,
        expiresAt: credential.expires_at,
      },
    });
  } catch (err: any) {
    return formatSafeServerError(res, err, 'GET_STUDENT_QR');
  }
});

// POST /api/v1/students/:id/revoke-qr - Revoke compromised or lost badge
studentRoutes.post(
  '/:id/revoke-qr',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No active school tenant selected.' });
      }

      const { reason } = req.body;

      db.prepare(`
        UPDATE qr_credentials SET
          is_revoked = 1,
          revoked_reason = ?,
          revoked_at = datetime('now')
        WHERE student_id = ? AND school_id = ? AND is_revoked = 0
      `).run(reason || 'Reported lost/damaged badge', req.params.id, schoolId);

      logAudit({
        schoolId,
        userId: req.user?.id,
        action: 'REVOKE_QR_CREDENTIAL',
        entityType: 'QR_CREDENTIAL',
        entityId: req.params.id,
        newValues: { reason },
      });

      return res.json({ success: true, message: 'QR credential revoked. Please issue a new badge.' });
    } catch (err: any) {
      return formatSafeServerError(res, err, 'REVOKE_STUDENT_QR');
    }
  }
);

// PUT /api/v1/students/guardians/:guardianId - Edit guardian details
studentRoutes.put(
  '/guardians/:guardianId',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No active school tenant selected.' });
      }

      const guardianId = req.params.guardianId;
      const existing = db.prepare('SELECT * FROM guardians WHERE id = ?').get(guardianId) as any;
      if (!existing) {
        return res.status(404).json({ success: false, error: 'GUARDIAN_NOT_FOUND' });
      }

      const { fullName, phone, email, relationship, occupation, address } = req.body;

      db.prepare(`
        UPDATE guardians SET
          full_name = COALESCE(?, full_name),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          relationship = COALESCE(?, relationship),
          occupation = COALESCE(?, occupation),
          address = COALESCE(?, address)
        WHERE id = ?
      `).run(
        fullName ? String(fullName).trim() : null,
        phone ? String(phone).trim() : null,
        email ? String(email).trim().toLowerCase() : null,
        relationship ? String(relationship).trim().toUpperCase() : null,
        occupation ? String(occupation).trim() : null,
        address ? String(address).trim() : null,
        guardianId
      );

      logAudit({
        schoolId,
        userId: req.user?.id,
        action: 'UPDATE_GUARDIAN',
        entityType: 'GUARDIAN',
        entityId: guardianId,
        newValues: req.body,
      });

      return res.json({ success: true, message: 'Parent / Guardian details updated successfully' });
    } catch (err: any) {
      return formatSafeServerError(res, err, 'UPDATE_GUARDIAN');
    }
  }
);
