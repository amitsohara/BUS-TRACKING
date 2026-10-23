import crypto from 'node:crypto';
import { Router, Response } from 'express';
import { db } from '../db.ts';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  checkLoginRateLimit,
  checkSignupRateLimit,
  checkPasswordResetRateLimit,
  formatSafeServerError,
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
  let primarySchool = primaryMembership
    ? {
        schoolId: primaryMembership.school_id,
        schoolName: primaryMembership.school_name,
        schoolCode: primaryMembership.school_code,
        role: primaryMembership.role,
      }
    : null;

  if (!primarySchool && user.system_role === 'PLATFORM_ADMIN') {
    const firstSchool = db
      .prepare("SELECT id, name, code FROM schools WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1")
      .get() as any;
    if (firstSchool) {
      primarySchool = {
        schoolId: firstSchool.id,
        schoolName: firstSchool.name,
        schoolCode: firstSchool.code,
        role: 'SCHOOL_ADMIN',
      };
    }
  }

  const token = generateToken(
    {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      systemRole: user.system_role,
    },
    primarySchool?.schoolId,
    primarySchool?.role
  );

  logAudit({
    schoolId: primarySchool?.schoolId,
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
    activeSchool: primarySchool,
    memberships,
  });
});

// POST /api/v1/auth/register-school (First Administrator Setup & Multi-Tenant Onboarding)
authRoutes.post('/register-school', async (req: AuthRequest, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkSignupRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many registration requests. Please wait a minute before attempting again.',
    });
  }

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
    try { db.exec('ROLLBACK;'); } catch (_) {}
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

  let activeSchool = req.schoolContext || (memberships[0] ? {
    schoolId: memberships[0].school_id,
    schoolName: memberships[0].school_name,
    schoolCode: memberships[0].school_code,
    role: memberships[0].role,
  } : null);

  if (!activeSchool && user.system_role === 'PLATFORM_ADMIN') {
    const firstSchool = db
      .prepare("SELECT id, name, code FROM schools WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1")
      .get() as any;
    if (firstSchool) {
      activeSchool = {
        schoolId: firstSchool.id,
        schoolName: firstSchool.name,
        schoolCode: firstSchool.code,
        role: 'SCHOOL_ADMIN',
      };
    }
  }

  return res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      systemRole: user.system_role,
    },
    activeSchool,
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

// DELETE /api/v1/auth/me (Account Deletion & PII Anonymization under DPDP/GDPR Right to be Forgotten)
authRoutes.delete('/me', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Anonymize user personal data in users table
    db.prepare(`
      UPDATE users SET
        full_name = 'Deleted User',
        email = ?,
        phone = NULL,
        password_hash = 'DELETED_ACCOUNT_REVOKED',
        is_active = 0,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(`anonymized_${userId}@deleted.privacy`, userId);

    // 2. Anonymize guardian profile if linked
    db.prepare(`
      UPDATE guardians SET
        full_name = 'Anonymized Guardian',
        phone = NULL,
        email = NULL,
        address = NULL
      WHERE user_id = ?
    `).run(userId);

    // 3. Deactivate school memberships
    db.prepare(`
      UPDATE school_memberships SET
        status = 'INACTIVE'
      WHERE user_id = ?
    `).run(userId);

    // 4. Remove push device tokens
    db.prepare('DELETE FROM device_tokens WHERE user_id = ?').run(userId);

    db.exec('COMMIT;');

    logAudit({
      schoolId: req.schoolContext?.schoolId,
      userId,
      action: 'ACCOUNT_DELETED_ANONYMIZED',
      entityType: 'USER',
      entityId: userId,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      message: 'Your account and personal data have been permanently anonymized and deleted.',
    });
  } catch (err: any) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    console.error('[Account Deletion Error]', err?.message || '[REDACTED_ERROR]');
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to process account deletion.' });
  }
});

// GET /api/v1/auth/invitation-info?token=... - Public token verification
authRoutes.get('/invitation-info', (req: AuthRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!token) {
    return res.status(400).json({ success: false, error: 'MISSING_TOKEN', message: 'Invitation token is required.' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const inv = db
    .prepare(`
      SELECT 
        si.id, si.email, si.full_name, si.role, si.status, si.expires_at,
        s.id as school_id, s.name as school_name, s.code as school_code, s.city as school_city, s.status as school_status
      FROM school_invitations si
      JOIN schools s ON si.school_id = s.id
      WHERE si.token_hash = ?
    `)
    .get(tokenHash) as any;

  if (!inv) {
    return res.status(404).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'This invitation link is invalid or has expired.',
    });
  }

  if (inv.status !== 'PENDING') {
    return res.status(400).json({
      success: false,
      error: 'INVITATION_ALREADY_USED',
      message: `This invitation is no longer active (status: ${inv.status}).`,
    });
  }

  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return res.status(410).json({
      success: false,
      error: 'INVITATION_EXPIRED',
      message: 'This invitation has expired. Please contact your platform administrator for a new invite.',
    });
  }

  if (inv.school_status !== 'ACTIVE') {
    return res.status(403).json({
      success: false,
      error: 'SCHOOL_INACTIVE',
      message: `The school "${inv.school_name}" is currently ${inv.school_status.toLowerCase()}. Registration is temporarily suspended.`,
    });
  }

  return res.json({
    success: true,
    invitation: {
      email: inv.email,
      fullName: inv.full_name,
      role: inv.role,
      schoolId: inv.school_id,
      schoolName: inv.school_name,
      schoolCode: inv.school_code,
      schoolCity: inv.school_city,
      expiresAt: inv.expires_at,
    },
  });
});

// POST /api/v1/auth/accept-invitation - Public account activation via invitation token
authRoutes.post('/accept-invitation', async (req: AuthRequest, res: Response) => {
  const { token, password, fullName, phone } = req.body;

  if (!token || !password) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Invitation token and password are required.',
    });
  }

  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'WEAK_PASSWORD',
      message: 'Password must be at least 8 characters long.',
    });
  }

  const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

  const inv = db
    .prepare(`
      SELECT 
        si.id, si.email, si.full_name, si.role, si.status, si.expires_at, si.school_id,
        s.name as school_name, s.code as school_code, s.status as school_status
      FROM school_invitations si
      JOIN schools s ON si.school_id = s.id
      WHERE si.token_hash = ?
    `)
    .get(tokenHash) as any;

  if (!inv) {
    return res.status(404).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid or non-existent invitation token.',
    });
  }

  if (inv.status !== 'PENDING') {
    return res.status(400).json({
      success: false,
      error: 'INVITATION_ALREADY_USED',
      message: `This invitation has already been ${inv.status.toLowerCase()}.`,
    });
  }

  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return res.status(410).json({
      success: false,
      error: 'INVITATION_EXPIRED',
      message: 'This invitation has expired.',
    });
  }

  if (inv.school_status !== 'ACTIVE') {
    return res.status(403).json({
      success: false,
      error: 'SCHOOL_INACTIVE',
      message: 'Cannot activate account: The associated school is currently inactive or suspended.',
    });
  }

  const effectiveFullName = (fullName || inv.full_name || '').trim();
  const effectivePhone = (phone || '').trim();
  const passwordHash = await hashPassword(password);

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Find or create user
    let user = db.prepare('SELECT id, email, full_name, phone, system_role FROM users WHERE LOWER(email) = ?').get(inv.email.toLowerCase()) as any;
    let userId = user?.id;

    if (!user) {
      userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active, email_verified)
        VALUES (?, ?, ?, ?, ?, 'USER', 1, 1)
      `).run(userId, inv.email.toLowerCase(), passwordHash, effectiveFullName, effectivePhone || null);
    } else {
      // User exists: update password and activate
      db.prepare(`
        UPDATE users SET
          password_hash = ?,
          is_active = 1,
          email_verified = 1,
          full_name = COALESCE(?, full_name),
          phone = COALESCE(?, phone),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(passwordHash, effectiveFullName || null, effectivePhone || null, userId);
    }

    // 2. Insert or update membership
    const existingMembership = db
      .prepare('SELECT id FROM school_memberships WHERE user_id = ? AND school_id = ?')
      .get(userId, inv.school_id) as any;

    if (existingMembership) {
      db.prepare("UPDATE school_memberships SET role = ?, status = 'ACTIVE' WHERE id = ?").run(inv.role, existingMembership.id);
    } else {
      const membershipId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.prepare(`
        INSERT INTO school_memberships (id, user_id, school_id, role, status)
        VALUES (?, ?, ?, ?, 'ACTIVE')
      `).run(membershipId, userId, inv.school_id, inv.role);
    }

    // 3. Mark invitation as ACCEPTED
    db.prepare("UPDATE school_invitations SET status = 'ACCEPTED', updated_at = datetime('now') WHERE id = ?").run(inv.id);

    db.exec('COMMIT;');

    const authUser = {
      id: userId,
      email: inv.email.toLowerCase(),
      fullName: effectiveFullName,
      systemRole: user?.system_role || 'USER',
    };

    const tokenJwt = generateToken(authUser, inv.school_id, inv.role);

    logAudit({
      schoolId: inv.school_id,
      userId,
      action: 'INVITATION_ACCEPTED',
      entityType: 'INVITATION',
      entityId: inv.id,
      newValues: { email: inv.email, role: inv.role, schoolId: inv.school_id },
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: `Account activated successfully! Welcome to ${inv.school_name}.`,
      token: tokenJwt,
      user: authUser,
      activeSchool: {
        schoolId: inv.school_id,
        schoolName: inv.school_name,
        schoolCode: inv.school_code,
        role: inv.role,
      },
    });
  } catch (err: any) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Failed to activate account.' });
  }
});

// POST /api/v1/auth/device-token - Register device push notification token (FCM/APNs) for any authenticated app user
authRoutes.post('/device-token', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { token, platform } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'token is required.' });
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

// POST /api/v1/auth/forgot-password - Password recovery request (Rate limit: 3 per hour)
authRoutes.post('/forgot-password', async (req: AuthRequest, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Valid email is required.' });
  }

  const rateLimitKey = `${ip}_${email.trim().toLowerCase()}`;
  if (!checkPasswordResetRateLimit(rateLimitKey)) {
    return res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many password reset requests. Please wait 1 hour before attempting again.',
    });
  }

  const user = db.prepare('SELECT id, email, full_name, is_active FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim()) as any;

  if (user && user.is_active) {
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    const resetId = `rst_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO school_invitations (id, school_id, email, full_name, role, token_hash, token_hint, invited_by_user_id, status, delivery_status, expires_at)
      VALUES (?, 'sch_dps_rkp', ?, ?, 'PASSWORD_RESET', ?, 'rst_hint', ?, 'PENDING', 'DISABLED_NO_GATEWAY', ?)
    `).run(resetId, user.email, user.full_name, tokenHash, user.id, expiresAt);

    logAudit({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: ip,
    });
  }

  return res.json({
    success: true,
    message: 'If the provided email is registered, password reset instructions have been dispatched.',
  });
});

// POST /api/v1/auth/reset-password - Complete password recovery using token (Rate limit: 3 per hour)
authRoutes.post('/reset-password', async (req: AuthRequest, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const { token, newPassword } = req.body;

  if (!checkPasswordResetRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many password reset attempts. Please wait 1 hour before attempting again.',
    });
  }

  if (!token || !newPassword) {
    return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Token and newPassword are required.' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters long.' });
  }

  const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
  const record = db.prepare("SELECT * FROM school_invitations WHERE token_hash = ? AND role = 'PASSWORD_RESET' AND status = 'PENDING'").get(tokenHash) as any;

  if (!record || new Date(record.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN', message: 'Password reset token is invalid or has expired.' });
  }

  const newHash = await hashPassword(newPassword);

  db.exec('BEGIN TRANSACTION;');
  try {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE LOWER(email) = LOWER(?)").run(newHash, record.email);
    db.prepare("UPDATE school_invitations SET status = 'ACCEPTED', updated_at = datetime('now') WHERE id = ?").run(record.id);
    db.exec('COMMIT;');

    logAudit({
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'USER',
      entityId: record.invited_by_user_id,
      ipAddress: ip,
    });

    return res.json({ success: true, message: 'Password has been reset successfully. Please log in with your new password.' });
  } catch (err: any) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    return formatSafeServerError(res, err, 'RESET_PASSWORD');
  }
});

