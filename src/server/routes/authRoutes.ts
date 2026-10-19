import { Router, Response } from 'express';
import { db } from '../db.ts';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  checkLoginRateLimit,
  authenticate,
  logAudit,
  AuthRequest,
} from '../auth.ts';
import { validateSecurityConfig } from '../securityConfig.ts';

export const authRoutes = Router();

// GET /api/v1/auth/config - Expose runtime environment capabilities safely
authRoutes.get('/config', (_req, res: Response) => {
  const config = validateSecurityConfig();
  return res.json({
    success: true,
    isProduction: config.isProduction,
    demoModeEnabled: !config.isProduction && config.seedSampleData,
  });
});

// POST /api/v1/auth/login
authRoutes.post('/login', async (req: AuthRequest, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many failed login attempts. Please wait 1 minute before trying again.',
    });
  }

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Email and password are required',
    });
  }

  const user = db
    .prepare('SELECT id, email, password_hash, full_name, phone, system_role, is_active FROM users WHERE LOWER(email) = LOWER(?)')
    .get(email.trim()) as any;

  if (!user || !user.is_active) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    logAudit({
      userId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: ip,
      userAgent: req.headers['user-agent'] as string,
    });
    return res.status(401).json({
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  }

  // Fetch school memberships for this user
  const memberships = db
    .prepare(`
      SELECT sm.id as membership_id, sm.school_id, sm.role, s.name as school_name, s.code as school_code, s.city, s.status as school_status
      FROM school_memberships sm
      JOIN schools s ON sm.school_id = s.id
      WHERE sm.user_id = ? AND sm.status = 'ACTIVE' AND s.status = 'ACTIVE'
    `)
    .all(user.id) as any[];

  // Choose default school if exists
  const primaryMembership = memberships[0];
  const token = generateToken(
    {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      systemRole: user.system_role,
    },
    primaryMembership?.school_id,
    primaryMembership?.role
  );

  logAudit({
    schoolId: primaryMembership?.school_id,
    userId: user.id,
    action: 'LOGIN_SUCCESS',
    entityType: 'USER',
    entityId: user.id,
    ipAddress: ip,
    userAgent: req.headers['user-agent'] as string,
  });

  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      systemRole: user.system_role,
    },
    activeSchool: primaryMembership
      ? {
          schoolId: primaryMembership.school_id,
          schoolName: primaryMembership.school_name,
          schoolCode: primaryMembership.school_code,
          role: primaryMembership.role,
        }
      : null,
    memberships,
  });
});

// POST /api/v1/auth/register-school (First Administrator Setup & Multi-Tenant Onboarding)
authRoutes.post('/register-school', async (req: AuthRequest, res: Response) => {
  const {
    schoolName,
    schoolCode,
    affiliationNumber,
    address,
    city,
    state,
    pincode,
    contactPhone,
    contactEmail,
    adminFullName,
    adminEmail,
    adminPassword,
    adminPhone,
  } = req.body;

  const effectiveSchoolName = (schoolName || '').trim();
  const effectiveSchoolCode = (schoolCode || '').trim();
  const effectiveCity = (city || 'New Delhi').trim();
  const effectiveAdminEmail = (adminEmail || '').trim().toLowerCase();
  const effectiveAdminFullName = (adminFullName || '').trim();
  const effectiveAdminPassword = (adminPassword || '').trim();
  const effectiveContactEmail = (contactEmail || adminEmail || '').trim().toLowerCase();
  const effectiveContactPhone = (contactPhone || adminPhone || '+91 98000 00000').trim();

  const missingFields: string[] = [];
  if (!effectiveSchoolName) missingFields.push('School Name');
  if (!effectiveSchoolCode) missingFields.push('School Code');
  if (!effectiveAdminFullName) missingFields.push('Administrator Name');
  if (!effectiveAdminEmail) missingFields.push('Administrator Email');
  if (!effectiveAdminPassword) missingFields.push('Administrator Password');

  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: `Please fill in all required fields: ${missingFields.join(', ')}.`,
    });
  }

  // Check unique constraints
  const existingSchool = db.prepare('SELECT id FROM schools WHERE LOWER(code) = LOWER(?)').get(effectiveSchoolCode);
  if (existingSchool) {
    return res.status(409).json({
      success: false,
      error: 'SCHOOL_CODE_EXISTS',
      message: `School code "${schoolCode}" is already taken. Please choose another code.`,
    });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(effectiveAdminEmail);
  if (existingUser) {
    return res.status(409).json({
      success: false,
      error: 'EMAIL_ALREADY_REGISTERED',
      message: `An account with email ${effectiveAdminEmail} already exists.`,
    });
  }

  const schoolId = `sch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const membershipId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const passwordHash = await hashPassword(effectiveAdminPassword);

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Create School
    db.prepare(`
      INSERT INTO schools (id, code, name, affiliation_number, address, city, state, pincode, contact_phone, contact_email, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      schoolId,
      effectiveSchoolCode.toUpperCase(),
      effectiveSchoolName,
      affiliationNumber || 'CBSE',
      address || effectiveCity,
      effectiveCity,
      state || 'Delhi',
      pincode || '110001',
      effectiveContactPhone,
      effectiveContactEmail
    );

    // 2. Tenant Settings
    db.prepare(`
      INSERT INTO tenant_settings (school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance, strict_reconciliation_required)
      VALUES (?, 45, 50, 1, 1)
    `).run(schoolId);

    // 3. Subscription (14-day Enterprise Trial)
    db.prepare(`
      INSERT INTO subscriptions (id, school_id, plan_name, status, max_vehicles, max_students, expires_at)
      VALUES (?, ?, 'ENTERPRISE', 'TRIAL', 25, 1000, date('now', '+14 days'))
    `).run(`sub_${schoolId}`, schoolId);

    // 4. Create School Admin User
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
      VALUES (?, ?, ?, ?, ?, 'USER', 1)
    `).run(userId, effectiveAdminEmail, passwordHash, effectiveAdminFullName, effectiveContactPhone);

    // 5. Create School Membership as SCHOOL_ADMIN
    db.prepare(`
      INSERT INTO school_memberships (id, user_id, school_id, role, status)
      VALUES (?, ?, ?, 'SCHOOL_ADMIN', 'ACTIVE')
    `).run(membershipId, userId, schoolId);

    db.exec('COMMIT;');

    const authUser = {
      id: userId,
      email: effectiveAdminEmail,
      fullName: effectiveAdminFullName,
      systemRole: 'USER',
    };
    const token = generateToken(authUser, schoolId, 'SCHOOL_ADMIN');

    logAudit({
      schoolId,
      userId,
      action: 'SCHOOL_ONBOARDED',
      entityType: 'SCHOOL',
      entityId: schoolId,
      newValues: { schoolName: effectiveSchoolName, schoolCode: effectiveSchoolCode, adminEmail: effectiveAdminEmail },
    });

    return res.status(201).json({
      success: true,
      message: 'School successfully registered. Welcome to SurakshaVahan!',
      token,
      user: authUser,
      activeSchool: {
        schoolId,
        schoolName: effectiveSchoolName,
        schoolCode: effectiveSchoolCode.toUpperCase(),
        role: 'SCHOOL_ADMIN',
      },
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    console.error('[Register School Error]', err);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Failed to onboard school. Database transaction rolled back.',
    });
  }
});

// POST /api/v1/auth/switch-context (Switch active school workspace)
authRoutes.post('/switch-context', authenticate, (req: AuthRequest, res: Response) => {
  const { schoolId } = req.body;
  if (!schoolId) {
    return res.status(400).json({ success: false, error: 'schoolId is required' });
  }

  const membership = db
    .prepare(`
      SELECT sm.role, s.id as school_id, s.name as school_name, s.code as school_code
      FROM school_memberships sm
      JOIN schools s ON sm.school_id = s.id
      WHERE sm.user_id = ? AND sm.school_id = ? AND sm.status = 'ACTIVE' AND s.status = 'ACTIVE'
    `)
    .get(req.user!.id, schoolId) as any;

  if (!membership && req.user!.systemRole !== 'PLATFORM_ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'TENANT_ACCESS_DENIED',
      message: 'You do not have active membership in this school.',
    });
  }

  const role = membership ? membership.role : 'SCHOOL_ADMIN';
  const schoolName = membership ? membership.school_name : 'Platform Management';
  const schoolCode = membership ? membership.school_code : 'PLATFORM';

  const newToken = generateToken(req.user!, schoolId, role);

  return res.json({
    success: true,
    token: newToken,
    activeSchool: {
      schoolId,
      schoolName,
      schoolCode,
      role,
    },
  });
});

// GET /api/v1/auth/me
authRoutes.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  const user = db
    .prepare('SELECT id, email, full_name, phone, system_role, is_active FROM users WHERE id = ?')
    .get(req.user!.id) as any;

  if (!user) {
    return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  }

  const memberships = db
    .prepare(`
      SELECT sm.id as membership_id, sm.school_id, sm.role, s.name as school_name, s.code as school_code, s.status as school_status
      FROM school_memberships sm
      JOIN schools s ON sm.school_id = s.id
      WHERE sm.user_id = ? AND sm.status = 'ACTIVE'
    `)
    .all(user.id) as any[];

  return res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      systemRole: user.system_role,
    },
    activeSchool: req.schoolContext || (memberships[0] ? {
      schoolId: memberships[0].school_id,
      schoolName: memberships[0].school_name,
      schoolCode: memberships[0].school_code,
      role: memberships[0].role,
    } : null),
    memberships,
  });
});

// POST /api/v1/auth/logout
authRoutes.post('/logout', authenticate, (req: AuthRequest, res: Response) => {
  logAudit({
    schoolId: req.schoolContext?.schoolId,
    userId: req.user?.id,
    action: 'LOGOUT',
    entityType: 'USER',
    entityId: req.user?.id,
    ipAddress: req.ip,
  });
  return res.json({ success: true, message: 'Successfully logged out' });
});
