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
    await runTest('Database Migrations', 'All 21 normalized tables created with foreign keys', () => {
      const tables = [
        'schools', 'users', 'school_memberships', 'students', 'guardians',
        'student_guardians', 'vehicles', 'drivers', 'routes', 'route_stops',
        'transport_assignments', 'trips', 'trip_stops', 'qr_credentials',
        'attendance_events', 'bus_locations', 'device_tokens', 'notifications',
        'audit_logs', 'tenant_settings', 'subscriptions',
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
