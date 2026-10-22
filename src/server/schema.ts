import { db } from './db.ts';

export function runMigrations() {
  console.log('[Database] Applying database migrations and verifying schema integrity...');

  db.exec(`
    -- 1. Schools (Tenants)
    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      affiliation_number TEXT,
      board TEXT DEFAULT 'CBSE', -- CBSE, ICSE, State Board
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      pincode TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      timezone TEXT DEFAULT 'Asia/Kolkata',
      status TEXT DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, TRIAL
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Users (Global or School-associated)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      system_role TEXT DEFAULT 'USER', -- PLATFORM_ADMIN, USER
      is_active INTEGER DEFAULT 1,
      email_verified INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. School Memberships (Tenant Isolation & RBAC)
    CREATE TABLE IF NOT EXISTS school_memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      role TEXT NOT NULL, -- SCHOOL_ADMIN, TRANSPORT_MANAGER, DRIVER, ATTENDANT, PARENT
      status TEXT DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, REVOKED
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, school_id)
    );

    -- 4. Vehicles
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      registration_number TEXT NOT NULL, -- e.g. DL-01-AB-1234
      bus_number TEXT NOT NULL, -- Internal fleet identifier e.g. Bus #07
      capacity INTEGER NOT NULL,
      model TEXT,
      make TEXT,
      fuel_type TEXT DEFAULT 'DIESEL', -- DIESEL, CNG, ELECTRIC
      fitness_expiry TEXT,
      insurance_expiry TEXT,
      gps_device_id TEXT,
      status TEXT DEFAULT 'ACTIVE', -- ACTIVE, MAINTENANCE, RETIRED
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(school_id, registration_number)
    );

    -- 5. Drivers
    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      license_number TEXT NOT NULL,
      license_expiry TEXT NOT NULL,
      badge_number TEXT,
      emergency_contact TEXT,
      blood_group TEXT,
      years_experience INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE', -- ACTIVE, ON_LEAVE, TERMINATED
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(school_id, license_number)
    );

    -- 6. Routes
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      route_code TEXT NOT NULL, -- e.g. R-101
      name TEXT NOT NULL, -- e.g. Rohini Sector 14 Express
      description TEXT,
      morning_start_time TEXT, -- HH:MM (24-hr)
      evening_start_time TEXT, -- HH:MM (24-hr)
      default_vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
      default_driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(school_id, route_code)
    );

    -- 7. Route Stops
    CREATE TABLE IF NOT EXISTS route_stops (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      stop_name TEXT NOT NULL,
      landmark TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      sequence_order INTEGER NOT NULL,
      morning_scheduled_time TEXT, -- e.g. 07:15
      evening_scheduled_time TEXT, -- e.g. 14:45
      geofence_radius_meters INTEGER DEFAULT 50,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(route_id, sequence_order)
    );

    -- 8. Students
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      admission_number TEXT NOT NULL,
      full_name TEXT NOT NULL,
      grade TEXT NOT NULL, -- e.g. 5
      section TEXT NOT NULL, -- e.g. B
      roll_number TEXT,
      blood_group TEXT,
      emergency_phone TEXT NOT NULL,
      home_address TEXT,
      profile_photo_url TEXT,
      status TEXT DEFAULT 'ACTIVE', -- ACTIVE, ALUMNI, WITHDRAWN
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(school_id, admission_number)
    );

    -- 9. Guardians (Parents/Guardians)
    CREATE TABLE IF NOT EXISTS guardians (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      relationship TEXT DEFAULT 'PARENT', -- FATHER, MOTHER, GUARDIAN
      occupation TEXT,
      address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 10. Student Guardians (Relationship Mapping)
    CREATE TABLE IF NOT EXISTS student_guardians (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      guardian_id TEXT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
      is_primary INTEGER DEFAULT 1,
      can_pickup INTEGER DEFAULT 1,
      relationship_type TEXT DEFAULT 'FATHER',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, guardian_id)
    );

    -- 11. Transport Assignments
    CREATE TABLE IF NOT EXISTS transport_assignments (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      morning_route_id TEXT REFERENCES routes(id) ON DELETE SET NULL,
      morning_stop_id TEXT REFERENCES route_stops(id) ON DELETE SET NULL,
      evening_route_id TEXT REFERENCES routes(id) ON DELETE SET NULL,
      evening_stop_id TEXT REFERENCES route_stops(id) ON DELETE SET NULL,
      academic_year TEXT DEFAULT '2026-2027',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, academic_year)
    );

    -- 12. Trips (Scheduled or Live Runs)
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
      driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
      trip_type TEXT NOT NULL, -- MORNING_PICKUP, EVENING_DROP, SPECIAL
      trip_date TEXT NOT NULL, -- YYYY-MM-DD
      scheduled_start_time TEXT NOT NULL, -- ISO or HH:MM
      actual_start_time TEXT,
      actual_end_time TEXT,
      status TEXT DEFAULT 'SCHEDULED', -- SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED
      cancellation_reason TEXT,
      started_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      completed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      total_distance_km REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 13. Trip Stops (Status of each stop during a trip)
    CREATE TABLE IF NOT EXISTS trip_stops (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      route_stop_id TEXT NOT NULL REFERENCES route_stops(id) ON DELETE CASCADE,
      stop_order INTEGER NOT NULL,
      status TEXT DEFAULT 'PENDING', -- PENDING, ARRIVED, DEPARTED, SKIPPED
      arrived_at TEXT,
      departed_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(trip_id, route_stop_id)
    );

    -- 14. QR Credentials (Cryptographically opaque tokens, student PII never in plaintext)
    CREATE TABLE IF NOT EXISTS qr_credentials (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL, -- SHA256 of opaque credential
      token_hint TEXT NOT NULL, -- Prefix like SV-QR-**** for debugging
      issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      is_revoked INTEGER DEFAULT 0,
      revoked_reason TEXT,
      revoked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 15. Attendance Events (Append-only immutable audit trail)
    CREATE TABLE IF NOT EXISTS attendance_events (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      stop_id TEXT REFERENCES route_stops(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL, -- BOARDING, DROP_OFF, ABSENT, MANUAL_OVERRIDE
      scan_method TEXT NOT NULL, -- QR, MANUAL
      scanned_by_user_id TEXT NOT NULL REFERENCES users(id),
      scanned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      latitude REAL,
      longitude REAL,
      manual_reason TEXT,
      verification_status TEXT DEFAULT 'VERIFIED', -- VERIFIED, FLAGGED
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 16. Bus Locations (GPS Ingestion Stream)
    CREATE TABLE IF NOT EXISTS bus_locations (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      speed_kmh REAL DEFAULT 0,
      heading REAL DEFAULT 0, -- 0-360 degrees
      accuracy_meters REAL DEFAULT 5,
      altitude REAL,
      recorded_at TEXT NOT NULL,
      ingested_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 17. Device Tokens (Push Notifications for Flutter Apps in Phase 2)
    CREATE TABLE IF NOT EXISTS device_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      platform TEXT NOT NULL, -- ANDROID, IOS, WEB
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, token)
    );

    -- 18. Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      notification_type TEXT NOT NULL, -- TRIP_STARTED, BOARDING, DROPOFF, DELAY, GEOFENCE, EMERGENCY
      related_trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
      related_student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
      delivery_status TEXT DEFAULT 'DELIVERED_IN_APP', -- DELIVERED_IN_APP, QUEUED, SENT, FAILED, DISABLED_NO_GATEWAY
      channel TEXT DEFAULT 'IN_APP', -- IN_APP, PUSH, SMS
      delivery_provider TEXT DEFAULT 'SURAKSHAVAHAN_INTERNAL',
      provider_response TEXT,
      idempotency_key TEXT UNIQUE,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 19. Audit Logs (DPDP Act & Enterprise Security Compliance)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL, -- e.g. TRIP_START, QR_SCAN, STUDENT_UPDATE, DATA_EXPORT
      entity_type TEXT NOT NULL, -- TRIP, STUDENT, USER, ROUTE, ATTENDANCE
      entity_id TEXT,
      old_values TEXT, -- JSON
      new_values TEXT, -- JSON
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 20. Tenant Settings
    CREATE TABLE IF NOT EXISTS tenant_settings (
      school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
      speed_limit_kmh INTEGER DEFAULT 50,
      geofence_buffer_meters INTEGER DEFAULT 50,
      allow_manual_attendance INTEGER DEFAULT 1,
      strict_reconciliation_required INTEGER DEFAULT 1,
      sms_notifications_enabled INTEGER DEFAULT 0,
      whatsapp_notifications_enabled INTEGER DEFAULT 0,
      tracking_refresh_seconds INTEGER DEFAULT 5,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 21. Subscriptions & SaaS Limits
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      school_id TEXT UNIQUE NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      plan_name TEXT DEFAULT 'PROFESSIONAL', -- STARTER, PROFESSIONAL, ENTERPRISE
      status TEXT DEFAULT 'ACTIVE', -- TRIAL, ACTIVE, PAST_DUE, CANCELLED
      max_vehicles INTEGER DEFAULT 25,
      max_students INTEGER DEFAULT 1500,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 22. School Administrator Invitations & Onboarding
    CREATE TABLE IF NOT EXISTS school_invitations (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT DEFAULT 'SCHOOL_ADMIN',
      token_hash TEXT UNIQUE NOT NULL,
      token_hint TEXT NOT NULL,
      invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'PENDING', -- PENDING, ACCEPTED, REVOKED, EXPIRED
      delivery_status TEXT DEFAULT 'DISABLED_NO_GATEWAY', -- DELIVERED_EMAIL, DISABLED_NO_GATEWAY
      delivery_provider TEXT DEFAULT 'SURAKSHAVAHAN_INTERNAL',
      last_sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for High-Performance Multi-Tenant Lookups & Realtime Queries
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON school_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_school ON school_memberships(school_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON school_invitations(token_hash);
    CREATE INDEX IF NOT EXISTS idx_invitations_school_status ON school_invitations(school_id, status);
    CREATE INDEX IF NOT EXISTS idx_invitations_email ON school_invitations(email);
    CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
    CREATE INDEX IF NOT EXISTS idx_vehicles_school ON vehicles(school_id);
    CREATE INDEX IF NOT EXISTS idx_drivers_school ON drivers(school_id);
    CREATE INDEX IF NOT EXISTS idx_routes_school ON routes(school_id);
    CREATE INDEX IF NOT EXISTS idx_route_stops_route ON route_stops(route_id, sequence_order);
    CREATE INDEX IF NOT EXISTS idx_trips_school_status ON trips(school_id, status);
    CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(trip_date);
    CREATE INDEX IF NOT EXISTS idx_bus_locations_trip_time ON bus_locations(trip_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_attendance_trip_student ON attendance_events(trip_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_school_time ON attendance_events(school_id, scanned_at);
    CREATE INDEX IF NOT EXISTS idx_qr_credentials_hash ON qr_credentials(token_hash);
    CREATE INDEX IF NOT EXISTS idx_audit_school_time ON audit_logs(school_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at);
  `);

  // Enforce unique boarding/drop-off constraint per trip and clean historical duplicate test runs
  try {
    db.exec(`
      DELETE FROM attendance_events
      WHERE rowid NOT IN (
        SELECT MIN(rowid)
        FROM attendance_events
        GROUP BY trip_id, student_id, event_type
      );
    `);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_trip_student_board_drop ON attendance_events(trip_id, student_id, event_type) WHERE event_type IN ('BOARDING', 'DROP_OFF');`);
  } catch (e) {
    // Unique index already exists or could not apply
  }

  // Ensure backward-compatible columns exist on notifications table
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN delivery_provider TEXT DEFAULT 'SURAKSHAVAHAN_INTERNAL';`);
  } catch (e) {
    // Column already exists
  }

  // Ensure contact_person column exists on schools table
  try {
    db.exec(`ALTER TABLE schools ADD COLUMN contact_person TEXT;`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN provider_response TEXT;`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN idempotency_key TEXT;`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency_key ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;`);
  } catch (e) {
    // Index already exists
  }

  // Ensure a default root Platform Admin exists so new deployments are never locked out
  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (userCount.count === 0) {
      // Default initial password hash for 'Admin@12345'
      const defaultAdminHash = '$2b$10$LeRo7dJbM.Kz/jvFZ.TZaOG2JlepkVNYqWIQ07PmN6un5V8UnMq9O';
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
        VALUES ('usr_plat_admin', 'platform.admin@surakshavahan.in', ?, 'Platform Super Admin', '+91 98100 11223', 'PLATFORM_ADMIN', 1)
      `).run(defaultAdminHash);
      console.log('[Database] Empty user database detected: Created default Platform Admin (platform.admin@surakshavahan.in / Admin@12345).');
    }
  } catch (err) {
    // Already provisioned or error handled
  }

  console.log('[Database] Schema migrations executed successfully.');
}
