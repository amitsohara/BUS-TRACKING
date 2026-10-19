import { Router, Response } from 'express';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, logAudit, hashPassword } from '../auth.ts';

export const driverRoutes = Router();

// GET /api/v1/drivers - List drivers for school
driverRoutes.get('/', authenticate, requireSchoolContext(), (req: AuthRequest, res: Response) => {
  const schoolId = req.schoolContext!.schoolId;
  const drivers = db
    .prepare(`
      SELECT d.*, u.email as user_email,
        (SELECT COUNT(*) FROM trips t WHERE t.driver_id = d.id AND t.status = 'IN_PROGRESS') as active_trips_count,
        (SELECT COUNT(*) FROM trips t WHERE t.driver_id = d.id AND t.status = 'COMPLETED') as total_completed_trips
      FROM drivers d
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.school_id = ?
      ORDER BY d.full_name ASC
    `)
    .all(schoolId);

  return res.json({ success: true, drivers });
});

// POST /api/v1/drivers - Register new driver
driverRoutes.post(
  '/',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
    const {
      fullName,
      phone,
      licenseNumber,
      licenseExpiry,
      badgeNumber,
      emergencyContact,
      bloodGroup,
      yearsExperience,
      email,
      loginPassword,
    } = req.body;

    if (!fullName || !phone || !licenseNumber || !licenseExpiry) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Full name, phone, driving license number, and license expiry date are required',
      });
    }

    const cleanLic = licenseNumber.trim().toUpperCase();
    const existing = db
      .prepare('SELECT id FROM drivers WHERE school_id = ? AND UPPER(license_number) = ?')
      .get(schoolId, cleanLic);

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_LICENSE',
        message: `Driver with license "${cleanLic}" is already registered in this school.`,
      });
    }

    const driverId = `drv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let userId: string | null = null;

    db.exec('BEGIN TRANSACTION;');
    try {
      // If driver credentials provided for mobile/driver app login
      if (email && loginPassword) {
        const cleanEmail = email.trim().toLowerCase();
        const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(cleanEmail) as any;

        if (existingUser) {
          userId = existingUser.id;
        } else {
          userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const pwdHash = await hashPassword(loginPassword);
          db.prepare(`
            INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
            VALUES (?, ?, ?, ?, ?, 'USER', 1)
          `).run(userId, cleanEmail, pwdHash, fullName.trim(), phone.trim());
        }

        // Add school membership as DRIVER
        db.prepare(`
          INSERT INTO school_memberships (id, user_id, school_id, role, status)
          VALUES (?, ?, ?, 'DRIVER', 'ACTIVE')
          ON CONFLICT(user_id, school_id) DO UPDATE SET role = 'DRIVER', status = 'ACTIVE'
        `).run(`mem_${userId}_${schoolId}`, userId, schoolId);
      }

      db.prepare(`
        INSERT INTO drivers (
          id, school_id, user_id, full_name, phone, license_number, license_expiry,
          badge_number, emergency_contact, blood_group, years_experience, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
      `).run(
        driverId,
        schoolId,
        userId,
        fullName.trim(),
        phone.trim(),
        cleanLic,
        licenseExpiry,
        badgeNumber || null,
        emergencyContact || null,
        bloodGroup || 'B+',
        yearsExperience ? parseInt(yearsExperience, 10) : 0
      );

      db.exec('COMMIT;');

      logAudit({
        schoolId,
        userId: req.user?.id,
        action: 'CREATE_DRIVER',
        entityType: 'DRIVER',
        entityId: driverId,
        newValues: { fullName, phone, licenseNumber: cleanLic },
      });

      return res.status(201).json({ success: true, message: 'Driver registered successfully', driverId });
    } catch (err: any) {
      db.exec('ROLLBACK;');
      return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }
);

// PUT /api/v1/drivers/:id - Update driver profile or status
driverRoutes.put(
  '/:id',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    const schoolId = req.schoolContext!.schoolId;
    const driverId = req.params.id;

    const existing = db.prepare('SELECT * FROM drivers WHERE id = ? AND school_id = ?').get(driverId, schoolId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'DRIVER_NOT_FOUND' });
    }

    const {
      fullName,
      phone,
      licenseNumber,
      licenseExpiry,
      badgeNumber,
      emergencyContact,
      bloodGroup,
      yearsExperience,
      status,
    } = req.body;

    db.prepare(`
      UPDATE drivers SET
        full_name = COALESCE(?, full_name),
        phone = COALESCE(?, phone),
        license_number = COALESCE(?, license_number),
        license_expiry = COALESCE(?, license_expiry),
        badge_number = COALESCE(?, badge_number),
        emergency_contact = COALESCE(?, emergency_contact),
        blood_group = COALESCE(?, blood_group),
        years_experience = COALESCE(?, years_experience),
        status = COALESCE(?, status),
        updated_at = datetime('now')
      WHERE id = ? AND school_id = ?
    `).run(
      fullName,
      phone,
      licenseNumber,
      licenseExpiry,
      badgeNumber,
      emergencyContact,
      bloodGroup,
      yearsExperience ? parseInt(yearsExperience, 10) : null,
      status,
      driverId,
      schoolId
    );

    logAudit({
      schoolId,
      userId: req.user?.id,
      action: 'UPDATE_DRIVER',
      entityType: 'DRIVER',
      entityId: driverId,
      newValues: req.body,
    });

    return res.json({ success: true, message: 'Driver updated successfully' });
  }
);
