import { Router, Response } from 'express';
import { db } from '../db.ts';
import { authenticate, requireSchoolContext, AuthRequest, formatSafeServerError } from '../auth.ts';

export const auditRoutes = Router();

// GET /api/v1/audit-logs - Tenant-isolated audit log viewer
auditRoutes.get(
  '/',
  authenticate,
  requireSchoolContext(['SCHOOL_ADMIN', 'PLATFORM_ADMIN']),
  (req: AuthRequest, res: Response) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: 'NO_SCHOOL_CONTEXT', message: 'No school tenant selected.' });
      }

      const action = (req.query.action as string) || '';
      const entityType = (req.query.entityType as string) || '';
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      const offset = (page - 1) * limit;

      let query = `
        SELECT a.*, u.full_name as user_name, u.email as user_email
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        WHERE a.school_id = ?
      `;
      const params: any[] = [schoolId];

      if (action) {
        query += ` AND a.action = ?`;
        params.push(action);
      }
      if (entityType) {
        query += ` AND a.entity_type = ?`;
        params.push(entityType);
      }

      const countRow = db.prepare(`SELECT COUNT(*) as total FROM (${query})`).get(...params) as { total: number };

      query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const logs = db.prepare(query).all(...params);

      return res.json({
        success: true,
        logs,
        pagination: {
          page,
          limit,
          total: countRow ? countRow.total : 0,
          totalPages: Math.ceil((countRow ? countRow.total : 0) / limit),
        },
      });
    } catch (err: any) {
      return formatSafeServerError(res, err, 'LIST_AUDIT_LOGS');
    }
  }
);
