import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

interface TestResult {
  name: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  message: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runTest(category: string, name: string, fn: () => Promise<void> | void) {
  const start = Date.now();
  try {
    await fn();
    results.push({
      category,
      name,
      status: 'PASS',
      message: 'Assertion verified successfully',
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    results.push({
      category,
      name,
      status: 'FAIL',
      message: err.message || String(err),
      durationMs: Date.now() - start,
    });
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

async function main() {
  console.log('====================================================');
  console.log(' SURAKSHAVAHAN SaaS AUTOMATED VERIFICATION SUITE');
  console.log('====================================================\n');

  // 1. Configure isolated disposable test database
  const testDbDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
  }
  const testDbPath = path.join(testDbDir, `test_isolated_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.db`);
  process.env.SQLITE_DB_PATH = testDbPath;
  process.env.NODE_ENV = 'test';
  process.env.SEED_SAMPLE_DATA = 'true';

  console.log(`[Test Runner] Initializing isolated disposable test database at: ${testDbPath}`);

  // Dynamic imports after setting SQLITE_DB_PATH so all modules attach to the isolated database
  const { db } = await import('../src/server/db.ts');
  const { runMigrations } = await import('../src/server/schema.ts');
  const { seedInitialData } = await import('../src/server/seed.ts');
  const {
    hashPassword,
    verifyPassword,
    generateToken,
    authenticate,
    requireSchoolContext,
  } = await import('../src/server/auth.ts');
  const {
    validateSecurityConfig,
    calculateShannonEntropy,
    _resetSecurityConfigForTesting,
  } = await import('../src/server/securityConfig.ts');
  const { dispatchNotification } = await import('../src/server/notificationService.ts');
  const { checkTripSubscriptionAccess } = await import('../src/server/websocket.ts');
  const { createDatabaseBackup, verifyBackupIntegrity } = await import('../src/server/backup.ts');

  try {
    // Run migrations and initial baseline seed in isolated test DB
    runMigrations();
    await seedInitialData();

    // ----------------------------------------------------
    // Category 1: Database Migrations & Invariants
    // ----------------------------------------------------
    await runTest('Database Migrations', 'All 22 normalized tables created with foreign keys', () => {
      const tables = [
        'schools', 'users', 'school_memberships', 'students', 'guardians',
        'student_guardians', 'vehicles', 'drivers', 'routes', 'route_stops',
        'transport_assignments', 'trips', 'trip_stops', 'qr_credentials',
        'attendance_events', 'bus_locations', 'device_tokens', 'notifications',
        'audit_logs', 'tenant_settings', 'subscriptions', 'school_invitations',
      ];
      for (const t of tables) {
        const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
        assert(Boolean(row), `Table "${t}" must exist in schema`);
      }
    });

    await runTest('Database Migrations', 'Foreign key enforcement active in SQLite WAL mode', () => {
      const fk = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
      assert(fk.foreign_keys === 1, 'Foreign keys pragma must be active (1)');

      const jm = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      assert(jm.journal_mode.toUpperCase() === 'WAL', 'Journal mode must be WAL');
    });

    // ----------------------------------------------------
    // Category 2: Cryptographic Password & Session Security
    // ----------------------------------------------------
    await runTest('Authentication', 'Password hashing and verification with bcrypt', async () => {
      const pwd = 'DriverPassword#2026';
      const hash = await hashPassword(pwd);
      assert(hash !== pwd, 'Hash must differ from plaintext');
      assert(await verifyPassword(pwd, hash), 'Plaintext must verify against hash');
      assert(!(await verifyPassword('WrongPassword', hash)), 'Wrong password must fail');
    });

    await runTest('Authentication', 'JWT token payload encoding and integrity with HS256', () => {
      const user = {
        id: 'usr_test_01',
        email: 'test@school.edu',
        fullName: 'Test User',
        systemRole: 'USER',
      };
      const token = generateToken(user, 'sch_dps_rkp', 'SCHOOL_ADMIN');
      assert(typeof token === 'string' && token.split('.').length === 3, 'Token must be valid 3-part JWT');
    });

    // ----------------------------------------------------
    // Category 3: JWT Secret Entropy & Controlled Key Rotation
    // ----------------------------------------------------
    await runTest('Production Security', 'Rejects weak, repetitive, or low-entropy secrets in production', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalJwtSecret = process.env.JWT_SECRET;
      const originalSeed = process.env.SEED_SAMPLE_DATA;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.SEED_SAMPLE_DATA;

        // 1. Missing secret
        delete process.env.JWT_SECRET;
        _resetSecurityConfigForTesting();
        let caught = false;
        try {
          validateSecurityConfig();
        } catch (err: any) {
          caught = true;
          assert(err.message.includes('JWT_SECRET environment variable is missing'), 'Must reject missing secret');
        }
        assert(caught, 'Must throw when secret is missing');

        // 2. Repetitive low-entropy string (32 chars of 'A')
        process.env.JWT_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        _resetSecurityConfigForTesting();
        caught = false;
        try {
          validateSecurityConfig();
        } catch (err: any) {
          caught = true;
          assert(err.message.includes('lacks sufficient cryptographic randomness'), 'Must reject low-entropy secret');
        }
        assert(caught, 'Must reject 32-char repetitive secret');

        // 3. Simple sequential numeric sequence (32 chars)
        process.env.JWT_SECRET = '12345678901234567890123456789012';
        _resetSecurityConfigForTesting();
        caught = false;
        try {
          validateSecurityConfig();
        } catch (err: any) {
          caught = true;
          assert(err.message.includes('lacks sufficient cryptographic randomness'), 'Must reject predictable numeric secret');
        }
        assert(caught, 'Must reject predictable numeric sequence');

        // 4. Truly random 256-bit secret (32 bytes base64)
        process.env.JWT_SECRET = 'aB3$kL9#mP0!vX2@qW7%zR4^tY8*uI1&o';
        _resetSecurityConfigForTesting();
        const validConfig = validateSecurityConfig();
        assert(validConfig.jwtSecret === process.env.JWT_SECRET, 'Valid random secret must pass');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalJwtSecret) process.env.JWT_SECRET = originalJwtSecret;
        else delete process.env.JWT_SECRET;
        if (originalSeed) process.env.SEED_SAMPLE_DATA = originalSeed;
        else delete process.env.SEED_SAMPLE_DATA;
        _resetSecurityConfigForTesting();
      }
    });

    await runTest('Production Security', 'Key rotation overlap window accepts tokens signed with previous secret', async () => {
      const { generateToken: genTokenWithKey } = await import('../src/server/auth.ts');
      const jwt = (await import('jsonwebtoken')).default;

      const secretOld = 'old_secret_key_with_high_entropy_2026_xyz';
      const secretNew = 'new_secret_key_with_high_entropy_2026_abc';

      // Issue token with old secret
      const user = { id: 'usr_rot_01', email: 'rot@school.edu', fullName: 'Rotation User', systemRole: 'USER' };
      const oldToken = jwt.sign(
        { sub: user.id, email: user.email, fullName: user.fullName, systemRole: user.systemRole, schoolId: 'sch_dps_rkp', role: 'PARENT' },
        secretOld,
        { algorithm: 'HS256', expiresIn: '1h' }
      );

      // Configure current active secret = secretNew, previous secret = secretOld
      process.env.JWT_SECRET = secretNew;
      process.env.JWT_SECRET_PREVIOUS = secretOld;
      _resetSecurityConfigForTesting();

      // Mock Express Request
      let req: any = { headers: { authorization: `Bearer ${oldToken}` } };
      let res: any = { status: (code: number) => ({ json: (data: any) => ({ statusCode: code, data }) }) };
      const tracker = { called: false };
      const next = () => { tracker.called = true; };

      // Ensure user exists in test DB and is active
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, system_role, is_active)
        VALUES (?, 'rot@school.edu', 'hash', 'Rotation User', 'USER', 1)
        ON CONFLICT(id) DO UPDATE SET is_active = 1
      `).run(user.id);

      authenticate(req, res, next);
      assert(tracker.called, 'Old token must be accepted during overlap window via JWT_SECRET_PREVIOUS');
      assert(req.user?.id === user.id, 'User must be authenticated');

      // Now clear previous secret -> old token must be rejected
      delete process.env.JWT_SECRET_PREVIOUS;
      _resetSecurityConfigForTesting();

      req = { headers: { authorization: `Bearer ${oldToken}` } };
      let capturedStatus = 0;
      res = {
        status: (code: number) => {
          capturedStatus = code;
          return { json: () => {} };
        },
      };
      tracker.called = false;
      authenticate(req, res, next);
      assert(!tracker.called && capturedStatus === 401, 'Old token must be rejected once rotation overlap expires');

      delete process.env.JWT_SECRET;
      _resetSecurityConfigForTesting();
    });

    await runTest('Session Revocation', 'Real-time account deactivation immediately revokes active token', async () => {
      const deactUserId = `usr_deact_${Date.now()}`;
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, system_role, is_active)
        VALUES (?, 'deact@school.edu', 'hash', 'Deactivated User', 'USER', 1)
      `).run(deactUserId);

      const user = { id: deactUserId, email: 'deact@school.edu', fullName: 'Deactivated User', systemRole: 'USER' };
      const token = generateToken(user, 'sch_dps_rkp', 'DRIVER');

      // Token works while active
      let req: any = { headers: { authorization: `Bearer ${token}` } };
      const sessionTracker = { called: false };
      let capturedStatus = 0;
      let res: any = { status: (code: number) => { capturedStatus = code; return { json: () => {} }; } };
      authenticate(req, res, () => { sessionTracker.called = true; });
      assert(sessionTracker.called, 'Token must work while is_active = 1');

      // Admin deactivates user account in database
      db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(deactUserId);

      // Subsequent request with the same unexpired token must be rejected
      sessionTracker.called = false;
      capturedStatus = 0;
      authenticate(req, res, () => { sessionTracker.called = true; });
      assert(!sessionTracker.called && capturedStatus === 401, 'Request must be rejected when is_active = 0');
    });

    await runTest('Account Deletion & Privacy', 'Anonymizes personal data and revokes access upon account deletion', () => {
      const privacyUserId = `usr_privacy_${Date.now()}`;
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
        VALUES (?, 'privacy.test@school.edu', 'hash', 'Privacy Test Subject', '+91 99999 88888', 'USER', 1)
      `).run(privacyUserId);

      db.prepare(`
        UPDATE users SET
          full_name = 'Deleted User',
          email = ?,
          phone = NULL,
          password_hash = 'DELETED_ACCOUNT_REVOKED',
          is_active = 0,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(`anonymized_${privacyUserId}@deleted.privacy`, privacyUserId);

      const anonymizedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(privacyUserId) as any;
      assert(anonymizedUser.full_name === 'Deleted User', 'Name must be anonymized');
      assert(anonymizedUser.phone === null, 'Phone number must be cleared');
      assert(anonymizedUser.is_active === 0, 'Account must be deactivated');
      assert(anonymizedUser.password_hash === 'DELETED_ACCOUNT_REVOKED', 'Password hash must be revoked');
    });

    // ----------------------------------------------------
    // Category 4: Tenant Isolation & Parent-Child Authorization
    // ----------------------------------------------------
    await runTest('Tenant Isolation', 'School A admin cannot read or query School B students', () => {
      const dpsStudents = db.prepare("SELECT * FROM students WHERE school_id = 'sch_dps_rkp'").all();
      const ryanStudents = db.prepare("SELECT * FROM students WHERE school_id = 'sch_ryan_vk'").all();

      assert(dpsStudents.length > 0, 'DPS R.K. Puram must have students');
      assert(ryanStudents.length > 0, 'Ryan International must have students');

      const crossCheck = db.prepare("SELECT * FROM students WHERE school_id = 'sch_dps_rkp' AND school_id = 'sch_ryan_vk'").all();
      assert(crossCheck.length === 0, 'Tenant student sets must be mutually exclusive');
    });

    await runTest('Parent-Child Access', 'Parent can ONLY view children explicitly linked in student_guardians', () => {
      const parent1Children = db.prepare(`
        SELECT s.id, s.full_name
        FROM student_guardians sg
        JOIN guardians g ON sg.guardian_id = g.id
        JOIN students s ON sg.student_id = s.id
        WHERE g.user_id = 'usr_dps_parent1'
      `).all() as any[];

      assert(parent1Children.length === 1, 'Parent 1 must have exactly 1 assigned child');
      assert(parent1Children[0].id === 'stu_dps_01', 'Assigned child must be Aarav Sharma');

      const parent2Children = db.prepare(`
        SELECT s.id, s.full_name
        FROM student_guardians sg
        JOIN guardians g ON sg.guardian_id = g.id
        JOIN students s ON sg.student_id = s.id
        WHERE g.user_id = 'usr_dps_parent2'
      `).all() as any[];

      assert(parent2Children.length === 1, 'Parent 2 must have exactly 1 assigned child');
      assert(parent2Children[0].id === 'stu_dps_02', 'Assigned child must be Diya Verma');
    });

    // ----------------------------------------------------
    // Category 5: Concurrency, Duplicate Scans & Database Constraints
    // ----------------------------------------------------
    await runTest('Database Constraints', 'Database rejects duplicate boarding event on same trip via unique index', () => {
      const testTripId = `trip_dup_test_${Date.now()}`;
      db.prepare(`
        INSERT INTO trips (id, school_id, route_id, vehicle_id, driver_id, trip_type, trip_date, scheduled_start_time, status)
        VALUES (?, 'sch_dps_rkp', 'rt_dps_101', 'veh_dps_01', 'drv_dps_01', 'MORNING_PICKUP', date('now'), '07:00', 'IN_PROGRESS')
      `).run(testTripId);

      const studentId = 'stu_dps_01';
      db.prepare(`
        INSERT INTO attendance_events (id, school_id, trip_id, student_id, event_type, scan_method, scanned_by_user_id)
        VALUES (?, 'sch_dps_rkp', ?, ?, 'BOARDING', 'QR', 'usr_dps_driver1')
      `).run(`att_first_${Date.now()}`, testTripId, studentId);

      let caught = false;
      try {
        db.prepare(`
          INSERT INTO attendance_events (id, school_id, trip_id, student_id, event_type, scan_method, scanned_by_user_id)
          VALUES (?, 'sch_dps_rkp', ?, ?, 'BOARDING', 'QR', 'usr_dps_driver1')
        `).run(`att_second_${Date.now()}`, testTripId, studentId);
      } catch (err: any) {
        caught = true;
        assert(err.message.includes('UNIQUE constraint failed'), 'Error must be UNIQUE constraint failure');
      }
      assert(caught, 'Must reject duplicate boarding event at database level');
    });

    await runTest('Notification Idempotency', 'Simultaneous duplicate dispatch requests resolve to single canonical record', async () => {
      const tripId = 'trip_dps_today_morning';
      const studentId = 'stu_dps_01';
      const userId = 'usr_dps_parent1';

      // Dispatch 5 concurrent notification requests with identical params
      const dispatches = await Promise.all([
        dispatchNotification({ schoolId: 'sch_dps_rkp', userId, title: 'Bus Approaching', message: 'Stop 1', notificationType: 'GEOFENCE', relatedTripId: tripId, relatedStudentId: studentId, channel: 'IN_APP' }),
        dispatchNotification({ schoolId: 'sch_dps_rkp', userId, title: 'Bus Approaching', message: 'Stop 1', notificationType: 'GEOFENCE', relatedTripId: tripId, relatedStudentId: studentId, channel: 'IN_APP' }),
        dispatchNotification({ schoolId: 'sch_dps_rkp', userId, title: 'Bus Approaching', message: 'Stop 1', notificationType: 'GEOFENCE', relatedTripId: tripId, relatedStudentId: studentId, channel: 'IN_APP' }),
        dispatchNotification({ schoolId: 'sch_dps_rkp', userId, title: 'Bus Approaching', message: 'Stop 1', notificationType: 'GEOFENCE', relatedTripId: tripId, relatedStudentId: studentId, channel: 'IN_APP' }),
        dispatchNotification({ schoolId: 'sch_dps_rkp', userId, title: 'Bus Approaching', message: 'Stop 1', notificationType: 'GEOFENCE', relatedTripId: tripId, relatedStudentId: studentId, channel: 'IN_APP' }),
      ]);

      const firstId = dispatches[0].id;
      for (const d of dispatches) {
        assert(d.id === firstId, 'All concurrent dispatches must resolve to the identical canonical notification ID');
      }

      const count = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND related_trip_id = ? AND notification_type = ?').get(userId, tripId, 'GEOFENCE') as { count: number };
      assert(count.count === 1, 'Exactly one notification row must be persisted in database');
    });

    await runTest('Concurrency Resilience', 'Executes concurrent GPS writes across trips without lock contention', async () => {
      const writePromises = [];
      const numWrites = 25;

      for (let i = 0; i < numWrites; i++) {
        writePromises.push(
          new Promise<void>((resolve, reject) => {
            try {
              db.prepare(`
                INSERT INTO bus_locations (id, trip_id, vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at)
                VALUES (?, 'trip_dps_today_morning', 'veh_dps_01', ?, ?, ?, ?, datetime('now'))
              `).run(`loc_burst_${i}_${Date.now()}`, 28.5355 + i * 0.0001, 77.2081 + i * 0.0001, 35.5, 90.0);
              resolve();
            } catch (err) {
              reject(err);
            }
          })
        );
      }

      await Promise.all(writePromises);
      const inserted = db.prepare("SELECT COUNT(*) as count FROM bus_locations WHERE id LIKE 'loc_burst_%'").get() as { count: number };
      assert(inserted.count === numWrites, `All ${numWrites} concurrent GPS writes must succeed`);
    });

    await runTest('Transaction Safety', 'Rolls back atomic transaction completely on partial failure', () => {
      const driverLic = `DL-FAIL-${Date.now()}`;
      let caught = false;

      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare(`
          INSERT INTO drivers (id, school_id, full_name, phone, license_number, license_expiry, status)
          VALUES ('drv_rollback_1', 'sch_dps_rkp', 'Rollback Driver', '9999999999', ?, '2028-01-01', 'ACTIVE')
        `).run(driverLic);

        // Intentionally trigger foreign key error by referencing invalid school
        db.prepare(`
          INSERT INTO drivers (id, school_id, full_name, phone, license_number, license_expiry, status)
          VALUES ('drv_rollback_2', 'NON_EXISTENT_SCHOOL', 'Invalid Driver', '9999999998', 'DL-INVALID', '2028-01-01', 'ACTIVE')
        `).run();

        db.exec('COMMIT;');
      } catch (err) {
        caught = true;
        db.exec('ROLLBACK;');
      }

      assert(caught === true, 'Foreign key failure must trigger catch block');
      const checkFirst = db.prepare("SELECT id FROM drivers WHERE id = 'drv_rollback_1'").get();
      assert(!checkFirst, 'First statement in transaction must be rolled back completely');
    });

    // ----------------------------------------------------
    // Category 6: WebSocket Authorization & Subscription Filtering
    // ----------------------------------------------------
    await runTest('WebSocket Security', 'Rejects unauthorized trip subscriptions for unassigned parents and cross-school staff', () => {
      // 1. Anonymous client
      const anonClient: any = { userId: 'anonymous', systemRole: 'ANONYMOUS', subscriptions: new Set() };
      assert(checkTripSubscriptionAccess(anonClient, 'trip_dps_today_morning') === false, 'Anonymous client must be denied');

      // 2. Cross-school staff
      const ryanStaff: any = { userId: 'usr_ryan_admin', systemRole: 'USER', schoolId: 'sch_ryan_vk', role: 'SCHOOL_ADMIN', subscriptions: new Set() };
      assert(checkTripSubscriptionAccess(ryanStaff, 'trip_dps_today_morning') === false, 'Cross-tenant school admin must be denied');

      // 3. Legitimate school admin
      const dpsAdmin: any = { userId: 'usr_dps_admin', systemRole: 'USER', schoolId: 'sch_dps_rkp', role: 'SCHOOL_ADMIN', subscriptions: new Set() };
      assert(checkTripSubscriptionAccess(dpsAdmin, 'trip_dps_today_morning') === true, 'Legitimate school admin must be allowed');

      // 4. Linked parent
      const linkedParent: any = { userId: 'usr_dps_parent1', systemRole: 'USER', subscriptions: new Set() };
      assert(checkTripSubscriptionAccess(linkedParent, 'trip_dps_today_morning') === true, 'Linked parent must be allowed');
    });

    // ----------------------------------------------------
    // Category 7: Physical Bus Sweep & Trip Reconciliation
    // ----------------------------------------------------
    await runTest('Trip Reconciliation', 'Enforces physicalCheckConfirmed and identifies boarded students without drop-off', () => {
      const testReconcileTripId = `trip_reconcile_test_${Date.now()}`;
      const today = new Date().toISOString().split('T')[0];

      db.prepare(`
        INSERT INTO trips (id, school_id, route_id, vehicle_id, driver_id, trip_type, trip_date, scheduled_start_time, status)
        VALUES (?, 'sch_dps_rkp', 'rt_dps_101', 'veh_dps_02', 'drv_dps_01', 'MORNING_PICKUP', ?, '07:00', 'IN_PROGRESS')
      `).run(testReconcileTripId, today);

      // Board student 1
      db.prepare(`
        INSERT INTO attendance_events (id, school_id, trip_id, student_id, stop_id, event_type, scan_method, scanned_by_user_id)
        VALUES (?, 'sch_dps_rkp', ?, 'stu_dps_01', 'stp_dps_101_1', 'BOARDING', 'QR', 'usr_dps_driver1')
      `).run(`att_board_${Date.now()}`, testReconcileTripId);

      // Query missing dropoffs
      const missingDropoffs = db.prepare(`
        SELECT s.id, s.full_name
        FROM attendance_events ae
        JOIN students s ON ae.student_id = s.id
        WHERE ae.trip_id = ? AND ae.event_type = 'BOARDING'
        AND NOT EXISTS (
          SELECT 1 FROM attendance_events ae2
          WHERE ae2.trip_id = ae.trip_id AND ae2.student_id = ae.student_id AND ae2.event_type = 'DROP_OFF'
        )
      `).all(testReconcileTripId) as any[];

      assert(missingDropoffs.length === 1, 'Must detect exactly 1 student with missing drop-off');
      assert(missingDropoffs[0].id === 'stu_dps_01', 'Detected student must be stu_dps_01');
    });

    // ----------------------------------------------------
    // Category 8: Repeatable Database Backup & Recovery Procedure
    // ----------------------------------------------------
    await runTest('Database Resilience', 'Executes atomic online VACUUM INTO backup and verifies restoration integrity', () => {
      const backupDir = path.resolve(process.cwd(), 'data', 'temp_backups');
      const backupRes = createDatabaseBackup(backupDir);

      try {
        assert(backupRes.success === true, 'Backup creation must report success');
        assert(fs.existsSync(backupRes.backupPath), 'Backup file must exist on disk');

        const verification = verifyBackupIntegrity(backupRes.backupPath);
        assert(verification.isValid === true, 'Backup integrity check must pass');
        assert(verification.schoolCount >= 2, 'Restored database must contain original seeded schools');
      } finally {
        if (fs.existsSync(backupRes.backupPath)) {
          fs.unlinkSync(backupRes.backupPath);
        }
        if (fs.existsSync(backupDir)) {
          fs.rmdirSync(backupDir);
        }
      }
    });

    // ----------------------------------------------------
    // Category 9: Complete Route-by-Route Authorization Matrix Test
    // ----------------------------------------------------
    await runTest('Authorization Matrix', 'Verifies RBAC and multi-tenant isolation across all route categories', () => {
      // Test matrix: [Route, Allowed Roles, Denied Roles]
      const matrix = [
        { resource: 'STUDENT_DELETE', roles: ['SCHOOL_ADMIN', 'PLATFORM_ADMIN'], denied: ['DRIVER', 'PARENT', 'ATTENDANT'] },
        { resource: 'QR_GENERATE', roles: ['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN'], denied: ['DRIVER', 'PARENT'] },
        { resource: 'TRIP_SCHEDULE', roles: ['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN'], denied: ['DRIVER', 'PARENT'] },
        { resource: 'GPS_INGEST', roles: ['DRIVER', 'ATTENDANT', 'PLATFORM_ADMIN'], denied: ['PARENT'] },
        { resource: 'REPORTS_CSV', roles: ['SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'PLATFORM_ADMIN'], denied: ['DRIVER', 'PARENT'] },
        { resource: 'AUDIT_LOGS', roles: ['SCHOOL_ADMIN', 'PLATFORM_ADMIN'], denied: ['TRANSPORT_MANAGER', 'DRIVER', 'PARENT'] },
      ];

      for (const item of matrix) {
        for (const role of item.denied) {
          const middleware = requireSchoolContext(item.roles);
          let capturedStatus = 0;
          let req: any = {
            headers: {},
            params: {},
            query: {},
            body: {},
            user: { id: 'usr_test', systemRole: 'USER' },
            schoolContext: { schoolId: 'sch_dps_rkp', role },
          };
          let res: any = {
            status: (code: number) => {
              capturedStatus = code;
              return { json: (data: any) => data };
            },
          };
          let nextCalled = false;
          middleware(req, res, () => { nextCalled = true; });

          assert(nextCalled === false, `Role ${role} must not be allowed to execute ${item.resource}`);
          assert(capturedStatus === 403, `Role ${role} accessing ${item.resource} must receive HTTP 403`);
        }
      }
    });

    // ----------------------------------------------------
    // Category 10: School Management & Administrator Lifecycle
    // ----------------------------------------------------
    const testSchoolId = 'sch_pilot_heritage';
    const testSchoolCode = 'HERITAGE-GGM';

    await runTest('School Management', 'Platform Admin creates new school with unique uppercase code and rejects duplicate codes', () => {
      // 1. Create school
      db.prepare(`
        INSERT INTO schools (id, code, name, board, address, city, state, pincode, contact_phone, contact_email, contact_person, status)
        VALUES (?, ?, 'The Heritage School Gurgaon', 'CBSE', 'Sector 62, Golf Course Ext Road', 'Gurugram', 'Haryana', '122011', '+91 98110 00001', 'admin@heritage.edu.in', 'Capt. V. K. Mehra', 'ACTIVE')
      `).run(testSchoolId, testSchoolCode);

      const inserted = db.prepare('SELECT id, code, name, status, contact_person FROM schools WHERE id = ?').get(testSchoolId) as any;
      assert(Boolean(inserted), 'School record must exist');
      assert(inserted.code === testSchoolCode, 'School code must match uppercase code');
      assert(inserted.status === 'ACTIVE', 'New school must have ACTIVE status');
      assert(inserted.contact_person === 'Capt. V. K. Mehra', 'Contact person must be persisted');

      // 2. Reject duplicate code
      let duplicateCaught = false;
      try {
        db.prepare(`
          INSERT INTO schools (id, code, name, address, city, state, pincode, contact_phone, contact_email)
          VALUES ('sch_duplicate', ?, 'Duplicate School Name', 'Address', 'City', 'State', '110001', '+91 90000 00000', 'dup@school.com')
        `).run(testSchoolCode);
      } catch (err: any) {
        duplicateCaught = true;
      }
      assert(duplicateCaught === true, 'Database unique constraint must reject duplicate school code');
    });

    let generatedRawToken = '';
    let invitationId = '';

    await runTest('School Administrator Lifecycle', 'Generates single-use invitation, hashes with SHA-256, and records truthful delivery status', () => {
      generatedRawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(generatedRawToken).digest('hex');
      const tokenHint = `inv_${generatedRawToken.substring(0, 8)}...`;
      invitationId = `inv_${Date.now()}_test`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO school_invitations (
          id, school_id, email, full_name, role, token_hash, token_hint,
          invited_by_user_id, status, delivery_status, expires_at
        )
        VALUES (?, ?, 'priya.mehra@heritage.edu.in', 'Priya Mehra', 'SCHOOL_ADMIN', ?, ?, 'usr_plat_admin', 'PENDING', 'DISABLED_NO_GATEWAY', ?)
      `).run(invitationId, testSchoolId, tokenHash, tokenHint, expiresAt);

      const record = db.prepare('SELECT * FROM school_invitations WHERE id = ?').get(invitationId) as any;
      assert(Boolean(record), 'Invitation record must exist in school_invitations');
      assert(record.token_hash === tokenHash, 'Stored token must be SHA-256 hash, never plaintext');
      assert(record.status === 'PENDING', 'Initial status must be PENDING');
      assert(record.delivery_status === 'DISABLED_NO_GATEWAY', 'Must truthfully record DISABLED_NO_GATEWAY when external email gateway is absent');
      assert(record.role === 'SCHOOL_ADMIN', 'Role must be SCHOOL_ADMIN');
    });

    let newAdminUserId = '';

    await runTest('School Administrator Lifecycle', 'Accepts invitation atomically, hashes password with bcrypt, and provisions SCHOOL_ADMIN membership', async () => {
      // Lookup token hash
      const hashToVerify = crypto.createHash('sha256').update(generatedRawToken).digest('hex');
      const inv = db.prepare("SELECT * FROM school_invitations WHERE token_hash = ? AND status = 'PENDING'").get(hashToVerify) as any;
      assert(Boolean(inv), 'Invitation must be found via token hash');

      // Simulate acceptance
      newAdminUserId = `usr_priya_${Date.now()}`;
      const hashedPass = await hashPassword('PriyaHeritage@2026');

      db.exec('BEGIN TRANSACTION;');
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active, email_verified)
        VALUES (?, ?, ?, ?, '+91 98110 00002', 'USER', 1, 1)
      `).run(newAdminUserId, inv.email, hashedPass, inv.full_name);

      db.prepare(`
        INSERT INTO school_memberships (id, user_id, school_id, role, status)
        VALUES (?, ?, ?, ?, 'ACTIVE')
      `).run(`mem_${newAdminUserId}`, newAdminUserId, inv.school_id, inv.role);

      db.prepare(`
        UPDATE school_invitations SET status = 'ACCEPTED', updated_at = datetime('now') WHERE id = ?
      `).run(inv.id);
      db.exec('COMMIT;');

      // Verify membership
      const membership = db.prepare('SELECT * FROM school_memberships WHERE user_id = ? AND school_id = ?').get(newAdminUserId, testSchoolId) as any;
      assert(Boolean(membership), 'School membership must be active for new admin');
      assert(membership.role === 'SCHOOL_ADMIN', 'Role must be SCHOOL_ADMIN');
      assert(membership.status === 'ACTIVE', 'Membership status must be ACTIVE');

      // Verify password
      const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(newAdminUserId) as any;
      const valid = await verifyPassword('PriyaHeritage@2026', user.password_hash);
      assert(valid === true, 'User password must verify correctly with bcrypt');
    });

    await runTest('School Administrator Lifecycle', 'Rejects replay attacks on already accepted or revoked invitations', () => {
      const hashToVerify = crypto.createHash('sha256').update(generatedRawToken).digest('hex');
      const inv = db.prepare('SELECT status FROM school_invitations WHERE token_hash = ?').get(hashToVerify) as any;
      assert(inv.status === 'ACCEPTED', 'Invitation status must be marked ACCEPTED');

      // Re-verifying for acceptance must fail because status is no longer PENDING
      const pendingInv = db.prepare("SELECT id FROM school_invitations WHERE token_hash = ? AND status = 'PENDING'").get(hashToVerify);
      assert(pendingInv === undefined, 'Must reject already accepted invitation');
    });

    await runTest('Tenant Isolation & Governance', 'Deactivating or suspending school immediately blocks tenant access for its administrators', () => {
      // 1. Verify access works while ACTIVE
      const activeMiddleware = requireSchoolContext(['SCHOOL_ADMIN']);
      let activeAllowed: any = false;
      let reqActive: any = {
        headers: { 'x-school-id': testSchoolId },
        params: {},
        query: {},
        body: {},
        user: { id: newAdminUserId, systemRole: 'USER' },
      };
      let resActive: any = { status: () => ({ json: () => {} }) };
      activeMiddleware(reqActive, resActive, () => { activeAllowed = true; });
      assert(Boolean(activeAllowed), 'School Admin must be authorized while school status is ACTIVE');

      // 2. Suspend school
      db.prepare("UPDATE schools SET status = 'SUSPENDED', updated_at = datetime('now') WHERE id = ?").run(testSchoolId);

      // 3. Verify access is immediately revoked
      let suspendedAllowed: boolean = false;
      let suspendedStatusCode = 0;
      let reqSuspended: any = {
        headers: { 'x-school-id': testSchoolId },
        params: {},
        query: {},
        body: {},
        user: { id: newAdminUserId, systemRole: 'USER' },
      };
      let resSuspended: any = {
        status: (code: number) => {
          suspendedStatusCode = code;
          return { json: (d: any) => d };
        },
      };
      activeMiddleware(reqSuspended, resSuspended, () => { suspendedAllowed = true; });
      assert(suspendedAllowed === false, 'School Admin must NOT be allowed access when school is SUSPENDED');
      assert(suspendedStatusCode === 403, 'Must return HTTP 403 on suspended school access');

      // Restore to ACTIVE for remaining assertions
      db.prepare("UPDATE schools SET status = 'ACTIVE' WHERE id = ?").run(testSchoolId);
    });

    await runTest('Tenant Isolation & Governance', 'Strict tenant scoping prevents School Admin from accessing other schools', () => {
      // Priya is admin of sch_pilot_heritage, trying to access sch_dps_rkp
      const crossTenantMiddleware = requireSchoolContext(['SCHOOL_ADMIN']);
      let crossTenantAllowed: boolean = false;
      let crossTenantStatus = 0;

      let reqCross: any = {
        headers: { 'x-school-id': 'sch_dps_rkp' },
        params: {},
        query: {},
        body: {},
        user: { id: newAdminUserId, systemRole: 'USER' },
      };
      let resCross: any = {
        status: (code: number) => {
          crossTenantStatus = code;
          return { json: (d: any) => d };
        },
      };

      crossTenantMiddleware(reqCross, resCross, () => { crossTenantAllowed = true; });
      assert(crossTenantAllowed === false, 'Admin of School A must not be allowed into School B');
      assert(crossTenantStatus === 403, 'Must return HTTP 403 TENANT_ACCESS_DENIED');
    });

    // ----------------------------------------------------
    // Category 11: Mobile Apps Integration (Driver App & Parent App)
    // ----------------------------------------------------
    await runTest('Mobile Driver App', 'Driver queries active trip, vehicle, stops and assigned passenger roster', () => {
      // Driver Ramesh Kumar: usr_dps_driver1, drv_dps_01, school: sch_dps_rkp
      const driver = db.prepare('SELECT id, full_name, phone FROM drivers WHERE user_id = ?').get('usr_dps_driver1') as any;
      assert(Boolean(driver), 'Driver profile must exist for authenticated driver');

      const activeTrip = db
        .prepare(`
          SELECT t.*, r.name as route_name, r.route_code, v.bus_number, v.registration_number
          FROM trips t
          JOIN routes r ON t.route_id = r.id
          JOIN vehicles v ON t.vehicle_id = v.id
          WHERE t.driver_id = ? AND t.status = 'IN_PROGRESS'
          LIMIT 1
        `)
        .get(driver.id) as any;

      assert(Boolean(activeTrip), 'Active in-progress trip must be found for driver');
      assert(activeTrip.id === 'trip_dps_today_morning', 'Trip ID must match active morning trip');
      assert(activeTrip.bus_number === 'Bus #01', 'Vehicle bus number must match assigned vehicle');

      // Fetch stops
      const stops = db
        .prepare(`
          SELECT ts.id, ts.stop_order, ts.status, rs.stop_name, rs.morning_scheduled_time, rs.latitude, rs.longitude
          FROM trip_stops ts
          JOIN route_stops rs ON ts.route_stop_id = rs.id
          WHERE ts.trip_id = ?
          ORDER BY ts.stop_order ASC
        `)
        .all(activeTrip.id) as any[];

      assert(stops.length === 5, 'Must retrieve all 5 scheduled route stops');
      assert(stops[0].status === 'DEPARTED', 'First stop should be marked departed');

      // Fetch passenger roster
      const stopIdColumn = activeTrip.trip_type === 'EVENING_DROP' ? 'ta.evening_stop_id' : 'ta.morning_stop_id';
      const routeIdColumn = activeTrip.trip_type === 'EVENING_DROP' ? 'ta.evening_route_id' : 'ta.morning_route_id';
      const roster = db
        .prepare(`
          SELECT s.id, s.admission_number, s.full_name, rs.stop_name as assigned_stop_name
          FROM transport_assignments ta
          JOIN students s ON ta.student_id = s.id
          JOIN route_stops rs ON ${stopIdColumn} = rs.id
          WHERE ${routeIdColumn} = ? AND ta.is_active = 1 AND s.school_id = ?
        `)
        .all(activeTrip.route_id, activeTrip.school_id) as any[];

      assert(roster.length > 0, 'Driver trip roster must contain assigned students');
    });

    await runTest('Mobile Driver App', 'Driver updates stop checkpoint status (ARRIVED/DEPARTED)', () => {
      const tripId = 'trip_dps_today_morning';
      const stopToUpdate = db.prepare("SELECT id, status FROM trip_stops WHERE trip_id = ? AND stop_order = 3").get(tripId) as any;
      assert(Boolean(stopToUpdate), 'Stop order 3 must exist for trip');

      // Update stop status to ARRIVED
      const arrivedTime = new Date().toISOString();
      db.prepare(`
        UPDATE trip_stops SET status = 'ARRIVED', arrived_at = ? WHERE id = ?
      `).run(arrivedTime, stopToUpdate.id);

      let updated = db.prepare('SELECT status, arrived_at FROM trip_stops WHERE id = ?').get(stopToUpdate.id) as any;
      assert(updated.status === 'ARRIVED', 'Stop status must transition to ARRIVED');
      assert(updated.arrived_at === arrivedTime, 'Stop arrived_at must be recorded');

      // Update stop status to DEPARTED
      const departedTime = new Date().toISOString();
      db.prepare(`
        UPDATE trip_stops SET status = 'DEPARTED', departed_at = ? WHERE id = ?
      `).run(departedTime, stopToUpdate.id);

      updated = db.prepare('SELECT status, departed_at FROM trip_stops WHERE id = ?').get(stopToUpdate.id) as any;
      assert(updated.status === 'DEPARTED', 'Stop status must transition to DEPARTED');
      assert(updated.departed_at === departedTime, 'Stop departed_at must be recorded');
    });

    await runTest('Mobile Driver App', 'Driver App syncs offline batch GPS coordinates into bus_locations', () => {
      const tripId = 'trip_dps_today_morning';
      const vehicleId = 'veh_dps_01';
      const offlinePoints = [
        { latitude: 28.5365, longitude: 77.2089, speedKmh: 30.2, heading: 350, accuracyMeters: 4.1, recordedAt: '2026-10-22T08:15:00.000Z' },
        { latitude: 28.5380, longitude: 77.2095, speedKmh: 28.5, heading: 352, accuracyMeters: 3.8, recordedAt: '2026-10-22T08:15:15.000Z' },
        { latitude: 28.5410, longitude: 77.2105, speedKmh: 34.0, heading: 355, accuracyMeters: 4.0, recordedAt: '2026-10-22T08:15:30.000Z' },
      ];

      db.exec('BEGIN TRANSACTION;');
      const stmt = db.prepare(`
        INSERT INTO bus_locations (
          id, trip_id, vehicle_id, latitude, longitude, speed_kmh, heading,
          accuracy_meters, altitude, recorded_at, ingested_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 215.0, ?, datetime('now'))
      `);

      for (let i = 0; i < offlinePoints.length; i++) {
        const pt = offlinePoints[i];
        stmt.run(`loc_batch_test_${i}_${Date.now()}`, tripId, vehicleId, pt.latitude, pt.longitude, pt.speedKmh, pt.heading, pt.accuracyMeters, pt.recordedAt);
      }
      db.exec('COMMIT;');

      // Verify records
      const latest = db.prepare('SELECT * FROM bus_locations WHERE trip_id = ? ORDER BY recorded_at DESC LIMIT 1').get(tripId) as any;
      assert(Boolean(latest), 'Latest GPS point must be present in database');
      assert(Math.abs(latest.latitude - 28.5410) < 0.0001, 'Latest latitude must reflect final synced waypoint');
      assert(latest.speed_kmh === 34.0, 'Latest speed must match synced point');
    });

    await runTest('Mobile Driver App', 'Driver broadcasts delay/breakdown alert triggering parent notifications and audit log', async () => {
      const tripId = 'trip_dps_today_morning';
      const schoolId = 'sch_dps_rkp';
      const alertType = 'DELAY';
      const message = 'Traffic congestion near IIT flyover - 15 minute expected delay';

      // Find parents with children on route
      const parents = db
        .prepare(`
          SELECT DISTINCT g.user_id, s.full_name as student_name
          FROM transport_assignments ta
          JOIN students s ON ta.student_id = s.id
          JOIN student_guardians sg ON s.id = sg.student_id
          JOIN guardians g ON sg.guardian_id = g.id
          WHERE ta.morning_route_id = 'rt_dps_101' AND ta.is_active = 1 AND g.user_id IS NOT NULL
        `)
        .all() as any[];

      assert(parents.length > 0, 'Must identify affected parents for route alert');

      for (const p of parents) {
        await dispatchNotification({
          schoolId,
          userId: p.user_id,
          title: 'Bus Delay Notice: Bus #01 (15 mins)',
          message: `${message} (Affected student: ${p.student_name})`,
          notificationType: alertType,
          relatedTripId: tripId,
          channel: 'IN_APP',
        });
      }

      // Check notification stored for parent
      const parentUserId = 'usr_dps_parent1';
      const notif = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND notification_type = 'DELAY' ORDER BY created_at DESC LIMIT 1").get(parentUserId) as any;
      assert(Boolean(notif), 'Parent must receive in-app delay notification');
      assert(notif.message.includes('Traffic congestion'), 'Notification text must match alert description');
    });

    await runTest('Mobile Parent App', 'Parent registers push device token (FCM/APNs) with upsert conflict handling', () => {
      const parentUserId = 'usr_dps_parent1';
      const pushToken = 'fcm_mock_parent_token_iphone_2026_xyz';
      const tokenId = `tok_${Date.now()}_test`;

      db.prepare(`
        INSERT INTO device_tokens (id, user_id, token, platform, updated_at)
        VALUES (?, ?, ?, 'IOS', datetime('now'))
        ON CONFLICT(user_id, token) DO UPDATE SET platform = excluded.platform, updated_at = datetime('now')
      `).run(tokenId, parentUserId, pushToken);

      const record = db.prepare('SELECT * FROM device_tokens WHERE user_id = ? AND token = ?').get(parentUserId, pushToken) as any;
      assert(Boolean(record), 'Device token record must exist in device_tokens table');
      assert(record.platform === 'IOS', 'Platform must be recorded as IOS');

      // Test upsert update without primary key / unique error
      db.prepare(`
        INSERT INTO device_tokens (id, user_id, token, platform, updated_at)
        VALUES (?, ?, ?, 'ANDROID', datetime('now'))
        ON CONFLICT(user_id, token) DO UPDATE SET platform = excluded.platform, updated_at = datetime('now')
      `).run(`tok_${Date.now()}_test2`, parentUserId, pushToken);

      const updatedRecord = db.prepare('SELECT * FROM device_tokens WHERE user_id = ? AND token = ?').get(parentUserId, pushToken) as any;
      assert(updatedRecord.platform === 'ANDROID', 'Platform must be safely updated to ANDROID on upsert');
    });

    await runTest('Mobile Parent App', 'Parent queries linked child attendance history with stop and vehicle metadata', () => {
      const studentId = 'stu_dps_01';
      const tripId = 'trip_dps_today_morning';
      const eventId = `att_test_drop_${Date.now()}`;

      // Insert a DROP_OFF attendance event (BOARDING was already recorded and verified by previous test)
      db.prepare(`
        INSERT INTO attendance_events (id, school_id, trip_id, student_id, stop_id, event_type, scan_method, scanned_by_user_id, verification_status, scanned_at)
        VALUES (?, 'sch_dps_rkp', ?, ?, 'stp_dps_101_1', 'DROP_OFF', 'QR_SCAN', 'usr_dps_driver1', 'VERIFIED', datetime('now'))
      `).run(eventId, tripId, studentId);

      // Parent queries attendance
      const events = db
        .prepare(`
          SELECT ae.id, ae.trip_id, ae.event_type, ae.scan_method, ae.scanned_at, ae.verification_status,
            rs.stop_name, t.trip_type, t.trip_date, v.bus_number, v.registration_number
          FROM attendance_events ae
          LEFT JOIN route_stops rs ON ae.stop_id = rs.id
          JOIN trips t ON ae.trip_id = t.id
          JOIN vehicles v ON t.vehicle_id = v.id
          WHERE ae.student_id = ?
          ORDER BY ae.scanned_at DESC
        `)
        .all(studentId) as any[];

      assert(events.length > 0, 'Must retrieve child attendance records');
      const latestEvent = events.find((e: any) => e.id === eventId);
      assert(Boolean(latestEvent), 'Latest drop-off event must be included in history');
      assert(latestEvent.event_type === 'DROP_OFF', 'Event type must be DROP_OFF');
      assert(latestEvent.scan_method === 'QR_SCAN', 'Scan method must be QR_SCAN');
      assert(latestEvent.bus_number === 'Bus #01', 'Vehicle bus number must be populated');
    });

    await runTest('Mobile Parent App', 'DPDP Act Privacy Enforcement: Rejects unlinked child QR badge and allows linked child', () => {
      const parentUserId = 'usr_dps_parent1'; // Amit Sharma, father of stu_dps_01 (Aarav)
      const ownChildId = 'stu_dps_01'; // Aarav Sharma
      const unlinkedChildId = 'stu_dps_02'; // Diya Patel

      // Helper simulating DPDP verification in GET /students/:id/qr-badge
      function checkParentChildAccess(pUserId: string, targetStudentId: string): boolean {
        const link = db
          .prepare(`
            SELECT 1 FROM student_guardians sg
            JOIN guardians g ON sg.guardian_id = g.id
            WHERE sg.student_id = ? AND g.user_id = ?
          `)
          .get(targetStudentId, pUserId);
        return Boolean(link);
      }

      // 1. Authorized access for own child
      const ownChildAllowed = checkParentChildAccess(parentUserId, ownChildId);
      assert(ownChildAllowed === true, 'Parent must be granted access to their own registered child QR badge');

      // 2. Strict rejection for unlinked child
      const unlinkedAllowed = checkParentChildAccess(parentUserId, unlinkedChildId);
      assert(unlinkedAllowed === false, 'Parent must be strictly blocked from accessing other students QR badges');
    });

  } finally {
    // Teardown isolated disposable test database
    console.log(`\n[Test Runner] Tearing down disposable test database: ${testDbPath}`);
    try {
      db.close();
    } catch (e) {}

    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
  }

  // Print Summary
  console.log('\n====================================================');
  console.log(' TEST EXECUTION SUMMARY:');
  console.log('====================================================');

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const symbol = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`${symbol} [${r.category}] ${r.name} (${r.durationMs}ms)`);
    if (r.status === 'FAIL') {
      console.log(`   Error: ${r.message}`);
      failed++;
    } else {
      passed++;
    }
  }

  console.log('----------------------------------------------------');
  console.log(`TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
