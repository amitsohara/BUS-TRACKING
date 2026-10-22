import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import { getJwtSecret, getPreviousJwtSecret } from './securityConfig.ts';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  systemRole: string; // PLATFORM_ADMIN | USER
}

export interface UserSchoolContext {
  schoolId: string;
  role: 'SCHOOL_ADMIN' | 'TRANSPORT_MANAGER' | 'DRIVER' | 'ATTENDANT' | 'PARENT';
  schoolName: string;
  schoolCode: string;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
  schoolContext?: UserSchoolContext;
}

// Password hashing
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Token generation
export function generateToken(user: AuthenticatedUser, schoolId?: string, role?: string): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      systemRole: user.systemRole,
      schoolId: schoolId || null,
      role: role || null,
    },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' } as jwt.SignOptions
  );
}

// In-memory rate limiting for security-sensitive auth endpoints
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const passwordResetAttempts = new Map<string, { count: number; resetAt: number }>();
const signupAttempts = new Map<string, { count: number; resetAt: number }>();

/**
 * Strict Rate Limiter: Minimum 5 attempts per minute per IP on login
 */
export function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60 * 1000 }); // 1-minute window
    return true;
  }
  if (entry.count >= 5) {
    return false; // Rate limit exceeded: maximum 5 attempts per minute
  }
  entry.count++;
  return true;
}

/**
 * Strict Rate Limiter: Maximum 3 attempts per hour on password reset
 */
export function checkPasswordResetRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = passwordResetAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    passwordResetAttempts.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 }); // 1-hour window
    return true;
  }
  if (entry.count >= 3) {
    return false; // Rate limit exceeded: maximum 3 attempts per hour
  }
  entry.count++;
  return true;
}

/**
 * Strict Rate Limiter: Maximum 5 signup/onboarding attempts per minute per IP
 */
export function checkSignupRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = signupAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    signupAttempts.set(ip, { count: 1, resetAt: now + 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) {
    return false; // Rate limit exceeded
  }
  entry.count++;
  return true;
}

/**
 * Safe error responder: returns generic client message with correlation ID, never exposing database or system internals
 */
export function formatSafeServerError(res: Response, err: any, actionName: string): Response {
  const correlationId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  console.error(`[Server Error] [Action: ${actionName}] [Correlation ID: ${correlationId}]`, err?.message || err);
  return res.status(500).json({
    success: false,
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An internal server error occurred. Please try again or contact system support with the correlation ID.',
    correlationId,
  });
}

// Middleware: Authenticate Bearer JWT with rotation overlap & active user validation
export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Authentication token missing or invalid format',
    });
  }

  const token = authHeader.split(' ')[1];
  let payload: any = null;

  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  } catch (primaryErr) {
    // Controlled key overlap window: verify against previous secret if configured
    const previousSecret = getPreviousJwtSecret();
    if (previousSecret) {
      try {
        payload = jwt.verify(token, previousSecret, { algorithms: ['HS256'] });
      } catch (secondaryErr) {
        return res.status(401).json({
          success: false,
          error: 'TOKEN_EXPIRED_OR_INVALID',
          message: 'Session has expired or is invalid. Please log in again.',
        });
      }
    } else {
      return res.status(401).json({
        success: false,
        error: 'TOKEN_EXPIRED_OR_INVALID',
        message: 'Session has expired or is invalid. Please log in again.',
      });
    }
  }

  // Session Revocation: Real-time user account active status check
  const userRow = db.prepare('SELECT is_active FROM users WHERE id = ?').get(payload.sub) as
    | { is_active: number }
    | undefined;

  if (userRow && userRow.is_active === 0) {
    return res.status(401).json({
      success: false,
      error: 'ACCOUNT_DEACTIVATED',
      message: 'This user account has been deactivated. Access revoked.',
    });
  }

  req.user = {
    id: payload.sub,
    email: payload.email,
    fullName: payload.fullName,
    systemRole: payload.systemRole,
  };

  // If token already has active school context, set it
  if (payload.schoolId && payload.role) {
    req.schoolContext = {
      schoolId: payload.schoolId,
      role: payload.role,
      schoolName: payload.schoolName || '',
      schoolCode: payload.schoolCode || '',
    };
  }
  next();
}

// Middleware: Strict School-Level Tenant Isolation & RBAC
export function requireSchoolContext(allowedRoles?: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    }

    // Platform Admins can bypass school-specific checks if explicitly requesting global or targeting a school
    const requestedSchoolId =
      (req.headers['x-school-id'] as string) ||
      (req.params.schoolId as string) ||
      (req.query.schoolId as string) ||
      (req.body && req.body.schoolId);

    if (req.user.systemRole === 'PLATFORM_ADMIN') {
      if (requestedSchoolId) {
        const schoolRow = db
          .prepare('SELECT id, name, code FROM schools WHERE id = ?')
          .get(requestedSchoolId) as any;
        if (schoolRow) {
          req.schoolContext = {
            schoolId: schoolRow.id,
            role: 'SCHOOL_ADMIN',
            schoolName: schoolRow.name,
            schoolCode: schoolRow.code,
          };
          return next();
        }
      }
      // If platform admin without specific school header, proceed if route permits
      if (!allowedRoles || allowedRoles.includes('PLATFORM_ADMIN')) {
        return next();
      }
    }

    // Normal tenant isolation validation:
    // User must have an active membership in the target school
    let targetSchoolId = requestedSchoolId || (req.schoolContext && req.schoolContext.schoolId);

    if (!targetSchoolId) {
      // Find the user's primary/first active school membership
      const membership = db
        .prepare(`
          SELECT sm.school_id, sm.role, s.name as school_name, s.code as school_code
          FROM school_memberships sm
          JOIN schools s ON sm.school_id = s.id
          WHERE sm.user_id = ? AND sm.status = 'ACTIVE' AND s.status = 'ACTIVE'
          LIMIT 1
        `)
        .get(req.user.id) as any;

      if (!membership) {
        return res.status(403).json({
          success: false,
          error: 'NO_ACTIVE_SCHOOL_MEMBERSHIP',
          message: 'User does not belong to any active school tenant.',
        });
      }
      targetSchoolId = membership.school_id;
      req.schoolContext = {
        schoolId: membership.school_id,
        role: membership.role,
        schoolName: membership.school_name,
        schoolCode: membership.school_code,
      };
    } else {
      // Explicit targetSchoolId provided: verify membership rigorously in SQLite
      const membership = db
        .prepare(`
          SELECT sm.school_id, sm.role, s.name as school_name, s.code as school_code
          FROM school_memberships sm
          JOIN schools s ON sm.school_id = s.id
          WHERE sm.user_id = ? AND sm.school_id = ? AND sm.status = 'ACTIVE' AND s.status = 'ACTIVE'
        `)
        .get(req.user.id, targetSchoolId) as any;

      if (!membership && req.user.systemRole !== 'PLATFORM_ADMIN') {
        return res.status(403).json({
          success: false,
          error: 'TENANT_ACCESS_DENIED',
          message: 'Access denied: You are not authorized to view or modify records for this school.',
        });
      }

      if (membership) {
        req.schoolContext = {
          schoolId: membership.school_id,
          role: membership.role,
          schoolName: membership.school_name,
          schoolCode: membership.school_code,
        };
      }
    }

    // Role check if specific roles are required
    if (allowedRoles && allowedRoles.length > 0) {
      const userRole = req.schoolContext?.role;
      const isAllowed =
        (userRole && allowedRoles.includes(userRole)) ||
        (req.user.systemRole === 'PLATFORM_ADMIN' && allowedRoles.includes('PLATFORM_ADMIN'));

      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_ROLE_PERMISSIONS',
          message: `Action requires one of the following roles: ${allowedRoles.join(', ')}`,
        });
      }
    }

    next();
  };
}

// Audit Log recording helper
export function logAudit(params: {
  schoolId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: any;
  newValues?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  try {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    db.prepare(`
      INSERT INTO audit_logs (id, school_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      params.schoolId || null,
      params.userId || null,
      params.action,
      params.entityType,
      params.entityId || null,
      params.oldValues ? JSON.stringify(params.oldValues) : null,
      params.newValues ? JSON.stringify(params.newValues) : null,
      params.ipAddress || null,
      params.userAgent || null
    );
  } catch (err) {
    console.error('[Audit Log Error]', err);
  }
}
