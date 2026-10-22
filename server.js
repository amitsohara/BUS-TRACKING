// server.ts
import express from "express";
import http from "node:http";
import path2 from "node:path";
import cors from "cors";
import helmet from "helmet";
import { fileURLToPath } from "node:url";

// src/server/securityConfig.ts
import crypto from "node:crypto";
var cachedConfig = null;
var devEphemeralSecret = null;
function calculateShannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const frequencies = /* @__PURE__ */ new Map();
  for (const char of str) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
function validateSecurityConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const seedSampleDataEnv = (process.env.SEED_SAMPLE_DATA || "").trim().toLowerCase();
  const seedSampleData = seedSampleDataEnv === "true" || seedSampleDataEnv === "1";
  if (isProduction && seedSampleData) {
    console.warn("[Security Warning] SEED_SAMPLE_DATA=true is active in production. Sample demo records will be seeded if the database is uninitialized.");
  }
  const rawJwtSecret = process.env.JWT_SECRET;
  const rawJwtSecretPrevious = process.env.JWT_SECRET_PREVIOUS ? process.env.JWT_SECRET_PREVIOUS.trim() : null;
  if (isProduction) {
    if (!rawJwtSecret) {
      const errorMsg = "FATAL SECURITY ERROR: JWT_SECRET environment variable is missing in production. A securely generated secret of at least 32 random characters (or 256 bits of entropy) is required to start the server.";
      console.error(`[Security] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    if (rawJwtSecret.length < 32) {
      const errorMsg = `FATAL SECURITY ERROR: JWT_SECRET is too short (${rawJwtSecret.length} characters). Production mandates a minimum of 32 characters (e.g., generated via "openssl rand -base64 32").`;
      console.error(`[Security] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    const uniqueChars = new Set(rawJwtSecret).size;
    const entropy = calculateShannonEntropy(rawJwtSecret);
    const hasMultipleClasses = /[a-zA-Z]/.test(rawJwtSecret) && /[^a-zA-Z]/.test(rawJwtSecret) || /[0-9]/.test(rawJwtSecret) && /[^0-9]/.test(rawJwtSecret);
    if (uniqueChars < 12 || entropy < 3.4 || !hasMultipleClasses) {
      const errorMsg = `FATAL SECURITY ERROR: JWT_SECRET lacks sufficient cryptographic randomness (uniqueChars=${uniqueChars}, entropy=${entropy.toFixed(2)} bits/char). Predictable, repetitive, or single-character-class strings are prohibited in production. Generate a strong key via "openssl rand -base64 32".`;
      console.error(`[Security] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
  const effectiveJwtSecret = rawJwtSecret && rawJwtSecret.trim().length >= 16 ? rawJwtSecret.trim() : isProduction ? "" : getDevFallbackSecret();
  const jwtExpiresIn = process.env.JWT_EXPIRES_IN || (isProduction ? "2h" : "12h");
  cachedConfig = {
    jwtSecret: effectiveJwtSecret,
    jwtSecretPrevious: rawJwtSecretPrevious,
    jwtExpiresIn,
    isProduction,
    seedSampleData,
    nodeEnv
  };
  console.log(
    `[Security] Configuration validated: NODE_ENV=${nodeEnv}, JWT_SECRET_LENGTH=${effectiveJwtSecret.length} chars (HS256 enforced), KEY_ROTATION_OVERLAP=${rawJwtSecretPrevious ? "ENABLED" : "DISABLED"}, JWT_EXPIRES_IN=${jwtExpiresIn}, SEED_SAMPLE_DATA=${seedSampleData ? "ENABLED" : "DISABLED"}`
  );
  return cachedConfig;
}
function getDevFallbackSecret() {
  if (!devEphemeralSecret) {
    devEphemeralSecret = crypto.randomBytes(32).toString("hex");
    console.warn(
      "[Security Warning] JWT_SECRET not provided in environment. Generated a runtime ephemeral 256-bit secret for this session. (Never use in production!)"
    );
  }
  return devEphemeralSecret;
}
function getJwtSecret() {
  if (!cachedConfig) {
    return validateSecurityConfig().jwtSecret;
  }
  return cachedConfig.jwtSecret;
}
function getPreviousJwtSecret() {
  if (!cachedConfig) {
    return validateSecurityConfig().jwtSecretPrevious;
  }
  return cachedConfig.jwtSecretPrevious;
}

// src/server/db.ts
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
var DB_DIR = path.resolve(process.cwd(), "data");
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true, mode: 448 });
}
var resolvedDbPath = path.join(DB_DIR, "schoolbus.db");
if (process.env.SQLITE_DB_PATH) {
  const candidatePath = path.resolve(process.cwd(), process.env.SQLITE_DB_PATH);
  resolvedDbPath = candidatePath;
}
var db = new DatabaseSync(resolvedDbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA busy_timeout = 5000;");
console.log(`[Database] Connected to persistent SQLite database at: ${resolvedDbPath} (Engine: Embedded zero-port WAL)`);

// src/server/schema.ts
function runMigrations() {
  console.log("[Database] Applying database migrations and verifying schema integrity...");
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
  }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN delivery_provider TEXT DEFAULT 'SURAKSHAVAHAN_INTERNAL';`);
  } catch (e) {
  }
  try {
    db.exec(`ALTER TABLE schools ADD COLUMN contact_person TEXT;`);
  } catch (e) {
  }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN provider_response TEXT;`);
  } catch (e) {
  }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN idempotency_key TEXT;`);
  } catch (e) {
  }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency_key ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;`);
  } catch (e) {
  }
  try {
    const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
    if (userCount.count === 0) {
      const defaultAdminHash = "$2b$10$LeRo7dJbM.Kz/jvFZ.TZaOG2JlepkVNYqWIQ07PmN6un5V8UnMq9O";
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
        VALUES ('usr_plat_admin', 'platform.admin@surakshavahan.in', ?, 'Platform Super Admin', '+91 98100 11223', 'PLATFORM_ADMIN', 1)
      `).run(defaultAdminHash);
      console.log("[Database] Empty user database detected: Created default Platform Admin (platform.admin@surakshavahan.in / Admin@12345).");
    }
  } catch (err) {
  }
  console.log("[Database] Schema migrations executed successfully.");
}

// src/server/seed.ts
import bcrypt from "bcryptjs";
import crypto2 from "crypto";
async function seedInitialData() {
  const config = validateSecurityConfig();
  if (!config.seedSampleData) {
    console.log("[Seed] SEED_SAMPLE_DATA is not set to true. Skipping sample data population.");
    return;
  }
  if (!config.seedSampleData) {
    console.log("[Seed] SEED_SAMPLE_DATA is not set to true. Skipping sample data population.");
    return;
  }
  const existingSchools = db.prepare("SELECT COUNT(*) as count FROM schools").get();
  if (existingSchools.count > 0) {
    console.log("[Seed] Database already initialized with schools.");
    return;
  }
  console.log("[Seed] SEED_SAMPLE_DATA=true verified: Seeding initial demo schools, buses, and test personas...");
  const defaultPasswordHash = await bcrypt.hash("Admin@12345", 10);
  const driverPasswordHash = await bcrypt.hash("Driver@12345", 10);
  const parentPasswordHash = await bcrypt.hash("Parent@12345", 10);
  const platformAdminId = "usr_plat_admin";
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'PLATFORM_ADMIN', 1)
  `).run(platformAdminId, "platform.admin@surakshavahan.in", defaultPasswordHash, "Vikram Malhotra", "+91 98100 11223");
  const schoolAId = "sch_dps_rkp";
  db.prepare(`
    INSERT INTO schools (id, code, name, affiliation_number, board, address, city, state, pincode, contact_phone, contact_email, timezone, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolAId,
    "DPS-RKP",
    "Delhi Public School, R.K. Puram",
    "CBSE/AFF/2730015",
    "CBSE",
    "Sector XII, R.K. Puram",
    "New Delhi",
    "Delhi",
    "110022",
    "+91 11 4911 5555",
    "transport@dpsrkp.net",
    "Asia/Kolkata",
    "ACTIVE"
  );
  db.prepare(`
    INSERT INTO tenant_settings (school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance, strict_reconciliation_required)
    VALUES (?, 45, 50, 1, 1)
  `).run(schoolAId);
  db.prepare(`
    INSERT INTO subscriptions (id, school_id, plan_name, status, max_vehicles, max_students, expires_at)
    VALUES (?, ?, 'ENTERPRISE', 'ACTIVE', 50, 3000, '2027-12-31')
  `).run("sub_dps_rkp", schoolAId);
  const schoolAAdminId = "usr_dps_admin";
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(schoolAAdminId, "admin@dpsrkp.net", defaultPasswordHash, "Rajesh Sharma", "+91 98111 22334");
  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'SCHOOL_ADMIN', 'ACTIVE')
  `).run("mem_dps_admin", schoolAAdminId, schoolAId);
  const schoolATmId = "usr_dps_tm";
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(schoolATmId, "transport.manager@dpsrkp.net", defaultPasswordHash, "Suresh Verma", "+91 98111 33445");
  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'TRANSPORT_MANAGER', 'ACTIVE')
  `).run("mem_dps_tm", schoolATmId, schoolAId);
  const vehA1Id = "veh_dps_01";
  db.prepare(`
    INSERT INTO vehicles (id, school_id, registration_number, bus_number, capacity, model, make, fuel_type, fitness_expiry, insurance_expiry, gps_device_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vehA1Id,
    schoolAId,
    "DL-01-EB-4102",
    "Bus #01",
    42,
    "Starbus Ultra 42S",
    "Tata Motors",
    "CNG",
    "2027-06-30",
    "2027-04-15",
    "GPS-DEVICE-DEL-01",
    "ACTIVE"
  );
  const vehA2Id = "veh_dps_02";
  db.prepare(`
    INSERT INTO vehicles (id, school_id, registration_number, bus_number, capacity, model, make, fuel_type, fitness_expiry, insurance_expiry, gps_device_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vehA2Id,
    schoolAId,
    "DL-01-EB-4105",
    "Bus #02",
    35,
    "Skool Bus 35S",
    "Ashok Leyland",
    "CNG",
    "2027-08-30",
    "2027-05-20",
    "GPS-DEVICE-DEL-02",
    "ACTIVE"
  );
  const driverA1UserId = "usr_dps_driver1";
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(driverA1UserId, "driver.ramesh@dpsrkp.net", driverPasswordHash, "Ramesh Kumar", "+91 98765 43210");
  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'DRIVER', 'ACTIVE')
  `).run("mem_dps_driver1", driverA1UserId, schoolAId);
  const driverA1Id = "drv_dps_01";
  db.prepare(`
    INSERT INTO drivers (id, school_id, user_id, full_name, phone, license_number, license_expiry, badge_number, emergency_contact, blood_group, years_experience, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    driverA1Id,
    schoolAId,
    driverA1UserId,
    "Ramesh Kumar",
    "+91 98765 43210",
    "DL-0420110023456",
    "2029-10-15",
    "COMM-BDG-9842",
    "+91 98765 43219",
    "B+",
    12,
    "ACTIVE"
  );
  const routeA1Id = "rt_dps_101";
  db.prepare(`
    INSERT INTO routes (id, school_id, route_code, name, description, morning_start_time, evening_start_time, default_vehicle_id, default_driver_id, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    routeA1Id,
    schoolAId,
    "R-101",
    "Saket - Hauz Khas - RKP Express",
    "Serves Saket Metro, Malviya Nagar, and Hauz Khas en route to Sector 12",
    "06:45",
    "14:15",
    vehA1Id,
    driverA1Id
  );
  const stopsData = [
    { name: "Saket Metro Station (Gate 2)", landmark: "Opposite Select Citywalk", lat: 28.5204, lng: 77.2014, seq: 1, mTime: "06:45", eTime: "15:10" },
    { name: "Malviya Nagar Market", landmark: "Corner Gol Chakkar", lat: 28.5355, lng: 77.2081, seq: 2, mTime: "06:55", eTime: "15:00" },
    { name: "Hauz Khas Enclave Main Gate", landmark: "Near Aurobindo Marg", lat: 28.5494, lng: 77.2065, seq: 3, mTime: "07:10", eTime: "14:45" },
    { name: "IIT Flyover Crossing", landmark: "IIT Delhi Gate", lat: 28.5449, lng: 77.1926, seq: 4, mTime: "07:22", eTime: "14:32" },
    { name: "DPS R.K. Puram Campus Gate 1", landmark: "School Arrival Porch", lat: 28.5672, lng: 77.1723, seq: 5, mTime: "07:35", eTime: "14:15" }
  ];
  const stopIds = [];
  stopsData.forEach((st, idx) => {
    const stopId = `stp_dps_101_${idx + 1}`;
    stopIds.push(stopId);
    db.prepare(`
      INSERT INTO route_stops (id, route_id, stop_name, landmark, latitude, longitude, sequence_order, morning_scheduled_time, evening_scheduled_time, geofence_radius_meters)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 50)
    `).run(stopId, routeA1Id, st.name, st.landmark, st.lat, st.lng, st.seq, st.mTime, st.eTime);
  });
  const studentsData = [
    { id: "stu_dps_01", adm: "DPS-2022-0412", name: "Aarav Sharma", grade: "5", sec: "A", blood: "O+", emPhone: "+91 98111 88990", stopIdx: 0 },
    { id: "stu_dps_02", adm: "DPS-2021-0234", name: "Diya Patel", grade: "7", sec: "B", blood: "B+", emPhone: "+91 98111 88991", stopIdx: 1 },
    { id: "stu_dps_03", adm: "DPS-2023-0891", name: "Kabir Verma", grade: "3", sec: "C", blood: "A+", emPhone: "+91 98111 88992", stopIdx: 2 },
    { id: "stu_dps_04", adm: "DPS-2020-0112", name: "Ananya Gupta", grade: "8", sec: "A", blood: "AB+", emPhone: "+91 98111 88993", stopIdx: 3 }
  ];
  const parentUserId = "usr_dps_parent1";
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(parentUserId, "parent.sharma@gmail.com", parentPasswordHash, "Amit Sharma", "+91 98111 88990");
  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'PARENT', 'ACTIVE')
  `).run("mem_dps_parent1", parentUserId, schoolAId);
  const guardian1Id = "grd_dps_01";
  db.prepare(`
    INSERT INTO guardians (id, user_id, full_name, phone, email, relationship, address)
    VALUES (?, ?, ?, ?, ?, 'FATHER', 'Pocket B, Saket, New Delhi')
  `).run(guardian1Id, parentUserId, "Amit Sharma", "+91 98111 88990", "parent.sharma@gmail.com");
  studentsData.forEach((st) => {
    db.prepare(`
      INSERT INTO students (id, school_id, admission_number, full_name, grade, section, blood_group, emergency_phone, home_address, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(st.id, schoolAId, st.adm, st.name, st.grade, st.sec, st.blood, st.emPhone, "New Delhi");
    db.prepare(`
      INSERT INTO transport_assignments (id, school_id, student_id, morning_route_id, morning_stop_id, evening_route_id, evening_stop_id, academic_year, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, '2026-2027', 1)
    `).run(`ta_${st.id}`, schoolAId, st.id, routeA1Id, stopIds[st.stopIdx], routeA1Id, stopIds[st.stopIdx]);
    const opaqueToken = `SVQR_${crypto2.randomBytes(24).toString("hex")}`;
    const tokenHash = crypto2.createHash("sha256").update(opaqueToken).digest("hex");
    const tokenHint = `SV-QR-${opaqueToken.substring(5, 9).toUpperCase()}`;
    db.prepare(`
      INSERT INTO qr_credentials (id, school_id, student_id, token_hash, token_hint, expires_at, is_revoked)
      VALUES (?, ?, ?, ?, ?, '2027-03-31', 0)
    `).run(`qr_${st.id}`, schoolAId, st.id, tokenHash, tokenHint);
  });
  db.prepare(`
    INSERT INTO student_guardians (id, student_id, guardian_id, is_primary, can_pickup, relationship_type)
    VALUES (?, ?, ?, 1, 1, 'FATHER')
  `).run("sg_01", "stu_dps_01", guardian1Id);
  const parent2UserId = "usr_dps_parent2";
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(parent2UserId, "parent.patel@gmail.com", parentPasswordHash, "Sunita Patel", "+91 98111 88991");
  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'PARENT', 'ACTIVE')
  `).run("mem_dps_parent2", parent2UserId, schoolAId);
  const guardian2Id = "grd_dps_02";
  db.prepare(`
    INSERT INTO guardians (id, user_id, full_name, phone, email, relationship, address)
    VALUES (?, ?, ?, ?, ?, 'MOTHER', 'Block C, Saket, New Delhi')
  `).run(guardian2Id, parent2UserId, "Sunita Patel", "+91 98111 88991", "parent.patel@gmail.com");
  db.prepare(`
    INSERT INTO student_guardians (id, student_id, guardian_id, is_primary, can_pickup, relationship_type)
    VALUES (?, ?, ?, 1, 1, 'MOTHER')
  `).run("sg_02", "stu_dps_02", guardian2Id);
  const todayDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const tripA1Id = "trip_dps_today_morning";
  db.prepare(`
    INSERT INTO trips (id, school_id, route_id, vehicle_id, driver_id, trip_type, trip_date, scheduled_start_time, actual_start_time, status, started_by_user_id)
    VALUES (?, ?, ?, ?, ?, 'MORNING_PICKUP', ?, '06:45', datetime('now', '-25 minutes'), 'IN_PROGRESS', ?)
  `).run(tripA1Id, schoolAId, routeA1Id, vehA1Id, driverA1Id, todayDate, driverA1UserId);
  stopIds.forEach((sid, idx) => {
    const status = idx === 0 ? "DEPARTED" : idx === 1 ? "ARRIVED" : "PENDING";
    db.prepare(`
      INSERT INTO trip_stops (id, trip_id, route_stop_id, stop_order, status, arrived_at, departed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      `ts_${tripA1Id}_${idx}`,
      tripA1Id,
      sid,
      idx + 1,
      status,
      idx <= 1 ? "06:56" : null,
      idx === 0 ? "06:48" : null
    );
  });
  db.prepare(`
    INSERT INTO bus_locations (id, trip_id, vehicle_id, latitude, longitude, speed_kmh, heading, accuracy_meters, recorded_at)
    VALUES (?, ?, ?, 28.5360, 77.2085, 32.5, 345, 4.2, datetime('now'))
  `).run(`loc_${Date.now()}`, tripA1Id, vehA1Id);
  db.prepare(`
    INSERT INTO attendance_events (id, school_id, trip_id, student_id, stop_id, event_type, scan_method, scanned_by_user_id, scanned_at, latitude, longitude, verification_status)
    VALUES (?, ?, ?, ?, ?, 'BOARDING', 'QR', ?, datetime('now', '-20 minutes'), 28.5205, 77.2015, 'VERIFIED')
  `).run(`att_${Date.now()}`, schoolAId, tripA1Id, "stu_dps_01", stopIds[0], driverA1UserId);
  db.prepare(`
    INSERT INTO notifications (
      id, school_id, user_id, title, message, notification_type,
      related_trip_id, related_student_id, delivery_status, channel,
      delivery_provider, provider_response
    )
    VALUES (?, ?, ?, 'Bus Boarding Confirmed', 'Aarav Sharma safely boarded Bus #01 at Saket Metro Station.', 'BOARDING', ?, 'stu_dps_01', 'DELIVERED_IN_APP', 'IN_APP', 'SURAKSHAVAHAN_INTERNAL', 'Delivered to parent dashboard')
  `).run(`notif_${Date.now()}`, schoolAId, parentUserId, tripA1Id);
  const schoolBId = "sch_ryan_vk";
  db.prepare(`
    INSERT INTO schools (id, code, name, affiliation_number, board, address, city, state, pincode, contact_phone, contact_email, timezone, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolBId,
    "RYAN-VK",
    "Ryan International School, Vasant Kunj",
    "CBSE/AFF/2730198",
    "CBSE",
    "Sector C, Pocket 8, Vasant Kunj",
    "New Delhi",
    "Delhi",
    "110070",
    "+91 11 2689 3333",
    "admin@ryanvasantkunj.edu.in",
    "Asia/Kolkata",
    "ACTIVE"
  );
  db.prepare(`
    INSERT INTO tenant_settings (school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance, strict_reconciliation_required)
    VALUES (?, 40, 50, 1, 1)
  `).run(schoolBId);
  db.prepare(`
    INSERT INTO subscriptions (id, school_id, plan_name, status, max_vehicles, max_students, expires_at)
    VALUES (?, ?, 'PROFESSIONAL', 'ACTIVE', 20, 1000, '2027-10-31')
  `).run("sub_ryan_vk", schoolBId);
  const schoolBAdminId = "usr_ryan_admin";
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(schoolBAdminId, "admin@ryanvasantkunj.edu.in", defaultPasswordHash, "Meenakshi Iyer", "+91 98222 33445");
  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'SCHOOL_ADMIN', 'ACTIVE')
  `).run("mem_ryan_admin", schoolBAdminId, schoolBId);
  const vehB1Id = "veh_ryan_01";
  db.prepare(`
    INSERT INTO vehicles (id, school_id, registration_number, bus_number, capacity, model, make, fuel_type, fitness_expiry, insurance_expiry, gps_device_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vehB1Id,
    schoolBId,
    "DL-02-CB-9081",
    "Bus #10",
    38,
    "SML Isuzu Executive",
    "SML Isuzu",
    "CNG",
    "2027-09-15",
    "2027-08-01",
    "GPS-DEVICE-DEL-10",
    "ACTIVE"
  );
  db.prepare(`
    INSERT INTO students (id, school_id, admission_number, full_name, grade, section, blood_group, emergency_phone, home_address, status)
    VALUES (?, ?, 'RYAN-2023-0099', 'Rohan Mehra', '6', 'B', 'B+', '+91 98333 44556', 'Vasant Vihar, New Delhi', 'ACTIVE')
  `).run("stu_ryan_01", schoolBId);
  console.log("[Seed] Multi-tenant initial data successfully seeded.");
}

// src/server/websocket.ts
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
var activeClients = /* @__PURE__ */ new Map();
function checkTripSubscriptionAccess(client, tripId) {
  if (!client.userId || client.userId === "anonymous") {
    return false;
  }
  if (client.systemRole === "PLATFORM_ADMIN") {
    return true;
  }
  const trip = db.prepare("SELECT id, school_id, route_id, driver_id FROM trips WHERE id = ?").get(tripId);
  if (!trip) {
    return false;
  }
  if (client.schoolId && client.schoolId === trip.school_id) {
    if (client.role === "DRIVER") {
      const driver = db.prepare("SELECT id FROM drivers WHERE user_id = ? AND school_id = ?").get(client.userId, client.schoolId);
      if (driver && driver.id === trip.driver_id) {
        return true;
      }
    }
    if (["SCHOOL_ADMIN", "TRANSPORT_MANAGER"].includes(client.role || "")) {
      return true;
    }
  }
  const isLinkedParent = db.prepare(`
      SELECT 1 FROM student_guardians sg
      JOIN guardians g ON sg.guardian_id = g.id
      JOIN transport_assignments ta ON sg.student_id = ta.student_id
      WHERE g.user_id = ?
        AND (ta.morning_route_id = ? OR ta.evening_route_id = ?)
        AND ta.is_active = 1
      LIMIT 1
    `).get(client.userId, trip.route_id, trip.route_id);
  if (isLinkedParent) {
    return true;
  }
  return false;
}
function initWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    let userId = "anonymous";
    let systemRole = "ANONYMOUS";
    let schoolId = void 0;
    let role = void 0;
    if (token) {
      try {
        const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
        userId = decoded.sub;
        systemRole = decoded.systemRole;
        schoolId = decoded.schoolId || void 0;
        role = decoded.role || void 0;
      } catch (err) {
      }
    }
    const client = {
      ws,
      userId,
      systemRole,
      schoolId,
      role,
      subscriptions: /* @__PURE__ */ new Set(),
      isAlive: true
    };
    activeClients.set(ws, client);
    ws.on("pong", () => {
      client.isAlive = true;
    });
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, payload } = message;
        switch (type) {
          case "SUBSCRIBE_TRIP": {
            if (payload && payload.tripId) {
              const allowed = checkTripSubscriptionAccess(client, payload.tripId);
              if (!allowed) {
                ws.send(
                  JSON.stringify({
                    type: "ERROR",
                    payload: {
                      error: "SUBSCRIPTION_FORBIDDEN",
                      message: `Unauthorized subscription attempt for trip: ${payload.tripId}`
                    }
                  })
                );
                break;
              }
              const channel = `trip:${payload.tripId}`;
              client.subscriptions.add(channel);
              ws.send(JSON.stringify({ type: "SUBSCRIBED", payload: { channel } }));
            }
            break;
          }
          case "UNSUBSCRIBE_TRIP": {
            if (payload && payload.tripId) {
              const channel = `trip:${payload.tripId}`;
              client.subscriptions.delete(channel);
              ws.send(JSON.stringify({ type: "UNSUBSCRIBED", payload: { channel } }));
            }
            break;
          }
          case "PING": {
            ws.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
            break;
          }
          default:
            break;
        }
      } catch (e) {
      }
    });
    ws.on("close", () => {
      activeClients.delete(ws);
    });
    ws.on("error", () => {
      activeClients.delete(ws);
    });
    ws.send(
      JSON.stringify({
        type: "CONNECTED",
        payload: {
          serverTime: (/* @__PURE__ */ new Date()).toISOString(),
          userId,
          message: "Connected to SurakshaVahan Real-Time GPS & Trip Stream"
        }
      })
    );
  });
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = activeClients.get(ws);
      if (!client) return;
      if (client.isAlive === false) {
        activeClients.delete(ws);
        return ws.terminate();
      }
      client.isAlive = false;
      ws.ping();
    });
  }, 3e4);
  wss.on("close", () => {
    clearInterval(interval);
  });
  console.log("[WebSocket] Real-time engine initialized on /ws");
}
function broadcastTripLocation(tripId, locationData) {
  const channel = `trip:${tripId}`;
  const message = JSON.stringify({
    type: "LOCATION_UPDATE",
    tripId,
    payload: locationData
  });
  activeClients.forEach((client) => {
    if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}
function broadcastAttendanceEvent(tripId, attendanceData) {
  const channel = `trip:${tripId}`;
  const message = JSON.stringify({
    type: "ATTENDANCE_EVENT",
    tripId,
    payload: attendanceData
  });
  activeClients.forEach((client) => {
    if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}
function broadcastTripStatusChange(tripId, status, metadata = {}) {
  const channel = `trip:${tripId}`;
  const message = JSON.stringify({
    type: "TRIP_STATUS_CHANGED",
    tripId,
    payload: { status, ...metadata, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
  });
  activeClients.forEach((client) => {
    if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

// src/server/routes/authRoutes.ts
import crypto3 from "node:crypto";
import { Router } from "express";

// src/server/auth.ts
import bcrypt2 from "bcryptjs";
import jwt2 from "jsonwebtoken";
var JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "2h";
async function hashPassword(password) {
  const salt = await bcrypt2.genSalt(10);
  return bcrypt2.hash(password, salt);
}
async function verifyPassword(password, hash) {
  return bcrypt2.compare(password, hash);
}
function generateToken(user, schoolId, role) {
  return jwt2.sign(
    {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      systemRole: user.systemRole,
      schoolId: schoolId || null,
      role: role || null
    },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN, algorithm: "HS256" }
  );
}
var loginAttempts = /* @__PURE__ */ new Map();
var passwordResetAttempts = /* @__PURE__ */ new Map();
var signupAttempts = /* @__PURE__ */ new Map();
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60 * 1e3 });
    return true;
  }
  if (entry.count >= 5) {
    return false;
  }
  entry.count++;
  return true;
}
function checkPasswordResetRateLimit(key) {
  const now = Date.now();
  const entry = passwordResetAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    passwordResetAttempts.set(key, { count: 1, resetAt: now + 60 * 60 * 1e3 });
    return true;
  }
  if (entry.count >= 3) {
    return false;
  }
  entry.count++;
  return true;
}
function checkSignupRateLimit(ip) {
  const now = Date.now();
  const entry = signupAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    signupAttempts.set(ip, { count: 1, resetAt: now + 60 * 1e3 });
    return true;
  }
  if (entry.count >= 5) {
    return false;
  }
  entry.count++;
  return true;
}
function formatSafeServerError(res, err, actionName) {
  const correlationId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  console.error(`[Server Error] [Action: ${actionName}] [Correlation ID: ${correlationId}]`, err?.message || err);
  return res.status(500).json({
    success: false,
    error: "INTERNAL_SERVER_ERROR",
    message: "An internal server error occurred. Please try again or contact system support with the correlation ID.",
    correlationId
  });
}
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "UNAUTHORIZED",
      message: "Authentication token missing or invalid format"
    });
  }
  const token = authHeader.split(" ")[1];
  let payload = null;
  try {
    payload = jwt2.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
  } catch (primaryErr) {
    const previousSecret = getPreviousJwtSecret();
    if (previousSecret) {
      try {
        payload = jwt2.verify(token, previousSecret, { algorithms: ["HS256"] });
      } catch (secondaryErr) {
        return res.status(401).json({
          success: false,
          error: "TOKEN_EXPIRED_OR_INVALID",
          message: "Session has expired or is invalid. Please log in again."
        });
      }
    } else {
      return res.status(401).json({
        success: false,
        error: "TOKEN_EXPIRED_OR_INVALID",
        message: "Session has expired or is invalid. Please log in again."
      });
    }
  }
  const userRow = db.prepare("SELECT is_active FROM users WHERE id = ?").get(payload.sub);
  if (userRow && userRow.is_active === 0) {
    return res.status(401).json({
      success: false,
      error: "ACCOUNT_DEACTIVATED",
      message: "This user account has been deactivated. Access revoked."
    });
  }
  req.user = {
    id: payload.sub,
    email: payload.email,
    fullName: payload.fullName,
    systemRole: payload.systemRole
  };
  if (payload.schoolId && payload.role) {
    req.schoolContext = {
      schoolId: payload.schoolId,
      role: payload.role,
      schoolName: payload.schoolName || "",
      schoolCode: payload.schoolCode || ""
    };
  }
  next();
}
function requireSchoolContext(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    }
    const requestedSchoolId = req.headers["x-school-id"] || req.params.schoolId || req.query.schoolId || req.body && req.body.schoolId;
    if (req.user.systemRole === "PLATFORM_ADMIN") {
      if (requestedSchoolId) {
        const schoolRow = db.prepare("SELECT id, name, code FROM schools WHERE id = ?").get(requestedSchoolId);
        if (schoolRow) {
          req.schoolContext = {
            schoolId: schoolRow.id,
            role: "SCHOOL_ADMIN",
            schoolName: schoolRow.name,
            schoolCode: schoolRow.code
          };
          return next();
        }
      }
      if (!allowedRoles || allowedRoles.includes("PLATFORM_ADMIN")) {
        return next();
      }
    }
    let targetSchoolId = requestedSchoolId || req.schoolContext && req.schoolContext.schoolId;
    if (!targetSchoolId) {
      const membership = db.prepare(`
          SELECT sm.school_id, sm.role, s.name as school_name, s.code as school_code
          FROM school_memberships sm
          JOIN schools s ON sm.school_id = s.id
          WHERE sm.user_id = ? AND sm.status = 'ACTIVE' AND s.status = 'ACTIVE'
          LIMIT 1
        `).get(req.user.id);
      if (!membership) {
        return res.status(403).json({
          success: false,
          error: "NO_ACTIVE_SCHOOL_MEMBERSHIP",
          message: "User does not belong to any active school tenant."
        });
      }
      targetSchoolId = membership.school_id;
      req.schoolContext = {
        schoolId: membership.school_id,
        role: membership.role,
        schoolName: membership.school_name,
        schoolCode: membership.school_code
      };
    } else {
      const membership = db.prepare(`
          SELECT sm.school_id, sm.role, s.name as school_name, s.code as school_code
          FROM school_memberships sm
          JOIN schools s ON sm.school_id = s.id
          WHERE sm.user_id = ? AND sm.school_id = ? AND sm.status = 'ACTIVE' AND s.status = 'ACTIVE'
        `).get(req.user.id, targetSchoolId);
      if (!membership && req.user.systemRole !== "PLATFORM_ADMIN") {
        return res.status(403).json({
          success: false,
          error: "TENANT_ACCESS_DENIED",
          message: "Access denied: You are not authorized to view or modify records for this school."
        });
      }
      if (membership) {
        req.schoolContext = {
          schoolId: membership.school_id,
          role: membership.role,
          schoolName: membership.school_name,
          schoolCode: membership.school_code
        };
      }
    }
    if (allowedRoles && allowedRoles.length > 0) {
      const userRole = req.schoolContext?.role;
      const isAllowed = userRole && allowedRoles.includes(userRole) || req.user.systemRole === "PLATFORM_ADMIN" && allowedRoles.includes("PLATFORM_ADMIN");
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          error: "INSUFFICIENT_ROLE_PERMISSIONS",
          message: `Action requires one of the following roles: ${allowedRoles.join(", ")}`
        });
      }
    }
    next();
  };
}
function logAudit(params) {
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
    console.error("[Audit Log Error]", err);
  }
}

// src/server/routes/authRoutes.ts
var authRoutes = Router();
authRoutes.get("/config", (_req, res) => {
  const config = validateSecurityConfig();
  return res.json({
    success: true,
    isProduction: config.isProduction,
    demoModeEnabled: !config.isProduction && config.seedSampleData
  });
});
authRoutes.post("/login", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: "RATE_LIMIT_EXCEEDED",
      message: "Too many failed login attempts. Please wait 1 minute before trying again."
    });
  }
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "Email and password are required"
    });
  }
  const user = db.prepare("SELECT id, email, password_hash, full_name, phone, system_role, is_active FROM users WHERE LOWER(email) = LOWER(?)").get(email.trim());
  if (!user || !user.is_active) {
    return res.status(401).json({
      success: false,
      error: "INVALID_CREDENTIALS",
      message: "Invalid email or password"
    });
  }
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    logAudit({
      userId: user.id,
      action: "LOGIN_FAILED",
      entityType: "USER",
      entityId: user.id,
      ipAddress: ip,
      userAgent: req.headers["user-agent"]
    });
    return res.status(401).json({
      success: false,
      error: "INVALID_CREDENTIALS",
      message: "Invalid email or password"
    });
  }
  const memberships = db.prepare(`
      SELECT sm.id as membership_id, sm.school_id, sm.role, s.name as school_name, s.code as school_code, s.city, s.status as school_status
      FROM school_memberships sm
      JOIN schools s ON sm.school_id = s.id
      WHERE sm.user_id = ? AND sm.status = 'ACTIVE' AND s.status = 'ACTIVE'
    `).all(user.id);
  const primaryMembership = memberships[0];
  const token = generateToken(
    {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      systemRole: user.system_role
    },
    primaryMembership?.school_id,
    primaryMembership?.role
  );
  logAudit({
    schoolId: primaryMembership?.school_id,
    userId: user.id,
    action: "LOGIN_SUCCESS",
    entityType: "USER",
    entityId: user.id,
    ipAddress: ip,
    userAgent: req.headers["user-agent"]
  });
  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      systemRole: user.system_role
    },
    activeSchool: primaryMembership ? {
      schoolId: primaryMembership.school_id,
      schoolName: primaryMembership.school_name,
      schoolCode: primaryMembership.school_code,
      role: primaryMembership.role
    } : null,
    memberships
  });
});
authRoutes.post("/register-school", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!checkSignupRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: "RATE_LIMIT_EXCEEDED",
      message: "Too many registration requests. Please wait a minute before attempting again."
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
    adminPhone
  } = req.body;
  const effectiveSchoolName = (schoolName || "").trim();
  const effectiveSchoolCode = (schoolCode || "").trim();
  const effectiveCity = (city || "New Delhi").trim();
  const effectiveAdminEmail = (adminEmail || "").trim().toLowerCase();
  const effectiveAdminFullName = (adminFullName || "").trim();
  const effectiveAdminPassword = (adminPassword || "").trim();
  const effectiveContactEmail = (contactEmail || adminEmail || "").trim().toLowerCase();
  const effectiveContactPhone = (contactPhone || adminPhone || "+91 98000 00000").trim();
  const missingFields = [];
  if (!effectiveSchoolName) missingFields.push("School Name");
  if (!effectiveSchoolCode) missingFields.push("School Code");
  if (!effectiveAdminFullName) missingFields.push("Administrator Name");
  if (!effectiveAdminEmail) missingFields.push("Administrator Email");
  if (!effectiveAdminPassword) missingFields.push("Administrator Password");
  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: `Please fill in all required fields: ${missingFields.join(", ")}.`
    });
  }
  const existingSchool = db.prepare("SELECT id FROM schools WHERE LOWER(code) = LOWER(?)").get(effectiveSchoolCode);
  if (existingSchool) {
    return res.status(409).json({
      success: false,
      error: "SCHOOL_CODE_EXISTS",
      message: `School code "${schoolCode}" is already taken. Please choose another code.`
    });
  }
  const existingUser = db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(effectiveAdminEmail);
  if (existingUser) {
    return res.status(409).json({
      success: false,
      error: "EMAIL_ALREADY_REGISTERED",
      message: `An account with email ${effectiveAdminEmail} already exists.`
    });
  }
  const schoolId = `sch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const membershipId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const passwordHash = await hashPassword(effectiveAdminPassword);
  db.exec("BEGIN TRANSACTION;");
  try {
    db.prepare(`
      INSERT INTO schools (id, code, name, affiliation_number, address, city, state, pincode, contact_phone, contact_email, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      schoolId,
      effectiveSchoolCode.toUpperCase(),
      effectiveSchoolName,
      affiliationNumber || "CBSE",
      address || effectiveCity,
      effectiveCity,
      state || "Delhi",
      pincode || "110001",
      effectiveContactPhone,
      effectiveContactEmail
    );
    db.prepare(`
      INSERT INTO tenant_settings (school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance, strict_reconciliation_required)
      VALUES (?, 45, 50, 1, 1)
    `).run(schoolId);
    db.prepare(`
      INSERT INTO subscriptions (id, school_id, plan_name, status, max_vehicles, max_students, expires_at)
      VALUES (?, ?, 'ENTERPRISE', 'TRIAL', 25, 1000, date('now', '+14 days'))
    `).run(`sub_${schoolId}`, schoolId);
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
      VALUES (?, ?, ?, ?, ?, 'USER', 1)
    `).run(userId, effectiveAdminEmail, passwordHash, effectiveAdminFullName, effectiveContactPhone);
    db.prepare(`
      INSERT INTO school_memberships (id, user_id, school_id, role, status)
      VALUES (?, ?, ?, 'SCHOOL_ADMIN', 'ACTIVE')
    `).run(membershipId, userId, schoolId);
    db.exec("COMMIT;");
    const authUser = {
      id: userId,
      email: effectiveAdminEmail,
      fullName: effectiveAdminFullName,
      systemRole: "USER"
    };
    const token = generateToken(authUser, schoolId, "SCHOOL_ADMIN");
    logAudit({
      schoolId,
      userId,
      action: "SCHOOL_ONBOARDED",
      entityType: "SCHOOL",
      entityId: schoolId,
      newValues: { schoolName: effectiveSchoolName, schoolCode: effectiveSchoolCode, adminEmail: effectiveAdminEmail }
    });
    return res.status(201).json({
      success: true,
      message: "School successfully registered. Welcome to SurakshaVahan!",
      token,
      user: authUser,
      activeSchool: {
        schoolId,
        schoolName: effectiveSchoolName,
        schoolCode: effectiveSchoolCode.toUpperCase(),
        role: "SCHOOL_ADMIN"
      }
    });
  } catch (err) {
    db.exec("ROLLBACK;");
    console.error("[Register School Error]", err);
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
      message: "Failed to onboard school. Database transaction rolled back."
    });
  }
});
authRoutes.post("/switch-context", authenticate, (req, res) => {
  const { schoolId } = req.body;
  if (!schoolId) {
    return res.status(400).json({ success: false, error: "schoolId is required" });
  }
  const membership = db.prepare(`
      SELECT sm.role, s.id as school_id, s.name as school_name, s.code as school_code
      FROM school_memberships sm
      JOIN schools s ON sm.school_id = s.id
      WHERE sm.user_id = ? AND sm.school_id = ? AND sm.status = 'ACTIVE' AND s.status = 'ACTIVE'
    `).get(req.user.id, schoolId);
  if (!membership && req.user.systemRole !== "PLATFORM_ADMIN") {
    return res.status(403).json({
      success: false,
      error: "TENANT_ACCESS_DENIED",
      message: "You do not have active membership in this school."
    });
  }
  const role = membership ? membership.role : "SCHOOL_ADMIN";
  const schoolName = membership ? membership.school_name : "Platform Management";
  const schoolCode = membership ? membership.school_code : "PLATFORM";
  const newToken = generateToken(req.user, schoolId, role);
  return res.json({
    success: true,
    token: newToken,
    activeSchool: {
      schoolId,
      schoolName,
      schoolCode,
      role
    }
  });
});
authRoutes.get("/me", authenticate, (req, res) => {
  const user = db.prepare("SELECT id, email, full_name, phone, system_role, is_active FROM users WHERE id = ?").get(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
  }
  const memberships = db.prepare(`
      SELECT sm.id as membership_id, sm.school_id, sm.role, s.name as school_name, s.code as school_code, s.status as school_status
      FROM school_memberships sm
      JOIN schools s ON sm.school_id = s.id
      WHERE sm.user_id = ? AND sm.status = 'ACTIVE'
    `).all(user.id);
  return res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      systemRole: user.system_role
    },
    activeSchool: req.schoolContext || (memberships[0] ? {
      schoolId: memberships[0].school_id,
      schoolName: memberships[0].school_name,
      schoolCode: memberships[0].school_code,
      role: memberships[0].role
    } : null),
    memberships
  });
});
authRoutes.post("/logout", authenticate, (req, res) => {
  logAudit({
    schoolId: req.schoolContext?.schoolId,
    userId: req.user?.id,
    action: "LOGOUT",
    entityType: "USER",
    entityId: req.user?.id,
    ipAddress: req.ip
  });
  return res.json({ success: true, message: "Successfully logged out" });
});
authRoutes.delete("/me", authenticate, (req, res) => {
  const userId = req.user.id;
  db.exec("BEGIN TRANSACTION;");
  try {
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
    db.prepare(`
      UPDATE guardians SET
        full_name = 'Anonymized Guardian',
        phone = NULL,
        email = NULL,
        address = NULL
      WHERE user_id = ?
    `).run(userId);
    db.prepare(`
      UPDATE school_memberships SET
        status = 'INACTIVE'
      WHERE user_id = ?
    `).run(userId);
    db.prepare("DELETE FROM device_tokens WHERE user_id = ?").run(userId);
    db.exec("COMMIT;");
    logAudit({
      schoolId: req.schoolContext?.schoolId,
      userId,
      action: "ACCOUNT_DELETED_ANONYMIZED",
      entityType: "USER",
      entityId: userId,
      ipAddress: req.ip
    });
    return res.json({
      success: true,
      message: "Your account and personal data have been permanently anonymized and deleted."
    });
  } catch (err) {
    db.exec("ROLLBACK;");
    console.error("[Account Deletion Error]", err?.message || "[REDACTED_ERROR]");
    return res.status(500).json({ success: false, error: "SERVER_ERROR", message: "Failed to process account deletion." });
  }
});
authRoutes.get("/invitation-info", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!token) {
    return res.status(400).json({ success: false, error: "MISSING_TOKEN", message: "Invitation token is required." });
  }
  const tokenHash = crypto3.createHash("sha256").update(token).digest("hex");
  const inv = db.prepare(`
      SELECT 
        si.id, si.email, si.full_name, si.role, si.status, si.expires_at,
        s.id as school_id, s.name as school_name, s.code as school_code, s.city as school_city, s.status as school_status
      FROM school_invitations si
      JOIN schools s ON si.school_id = s.id
      WHERE si.token_hash = ?
    `).get(tokenHash);
  if (!inv) {
    return res.status(404).json({
      success: false,
      error: "INVALID_TOKEN",
      message: "This invitation link is invalid or has expired."
    });
  }
  if (inv.status !== "PENDING") {
    return res.status(400).json({
      success: false,
      error: "INVITATION_ALREADY_USED",
      message: `This invitation is no longer active (status: ${inv.status}).`
    });
  }
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return res.status(410).json({
      success: false,
      error: "INVITATION_EXPIRED",
      message: "This invitation has expired. Please contact your platform administrator for a new invite."
    });
  }
  if (inv.school_status !== "ACTIVE") {
    return res.status(403).json({
      success: false,
      error: "SCHOOL_INACTIVE",
      message: `The school "${inv.school_name}" is currently ${inv.school_status.toLowerCase()}. Registration is temporarily suspended.`
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
      expiresAt: inv.expires_at
    }
  });
});
authRoutes.post("/accept-invitation", async (req, res) => {
  const { token, password, fullName, phone } = req.body;
  if (!token || !password) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "Invitation token and password are required."
    });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({
      success: false,
      error: "WEAK_PASSWORD",
      message: "Password must be at least 8 characters long."
    });
  }
  const tokenHash = crypto3.createHash("sha256").update(token.trim()).digest("hex");
  const inv = db.prepare(`
      SELECT 
        si.id, si.email, si.full_name, si.role, si.status, si.expires_at, si.school_id,
        s.name as school_name, s.code as school_code, s.status as school_status
      FROM school_invitations si
      JOIN schools s ON si.school_id = s.id
      WHERE si.token_hash = ?
    `).get(tokenHash);
  if (!inv) {
    return res.status(404).json({
      success: false,
      error: "INVALID_TOKEN",
      message: "Invalid or non-existent invitation token."
    });
  }
  if (inv.status !== "PENDING") {
    return res.status(400).json({
      success: false,
      error: "INVITATION_ALREADY_USED",
      message: `This invitation has already been ${inv.status.toLowerCase()}.`
    });
  }
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return res.status(410).json({
      success: false,
      error: "INVITATION_EXPIRED",
      message: "This invitation has expired."
    });
  }
  if (inv.school_status !== "ACTIVE") {
    return res.status(403).json({
      success: false,
      error: "SCHOOL_INACTIVE",
      message: "Cannot activate account: The associated school is currently inactive or suspended."
    });
  }
  const effectiveFullName = (fullName || inv.full_name || "").trim();
  const effectivePhone = (phone || "").trim();
  const passwordHash = await hashPassword(password);
  db.exec("BEGIN TRANSACTION;");
  try {
    let user = db.prepare("SELECT id, email, full_name, phone, system_role FROM users WHERE LOWER(email) = ?").get(inv.email.toLowerCase());
    let userId = user?.id;
    if (!user) {
      userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active, email_verified)
        VALUES (?, ?, ?, ?, ?, 'USER', 1, 1)
      `).run(userId, inv.email.toLowerCase(), passwordHash, effectiveFullName, effectivePhone || null);
    } else {
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
    const existingMembership = db.prepare("SELECT id FROM school_memberships WHERE user_id = ? AND school_id = ?").get(userId, inv.school_id);
    if (existingMembership) {
      db.prepare("UPDATE school_memberships SET role = ?, status = 'ACTIVE' WHERE id = ?").run(inv.role, existingMembership.id);
    } else {
      const membershipId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.prepare(`
        INSERT INTO school_memberships (id, user_id, school_id, role, status)
        VALUES (?, ?, ?, ?, 'ACTIVE')
      `).run(membershipId, userId, inv.school_id, inv.role);
    }
    db.prepare("UPDATE school_invitations SET status = 'ACCEPTED', updated_at = datetime('now') WHERE id = ?").run(inv.id);
    db.exec("COMMIT;");
    const authUser = {
      id: userId,
      email: inv.email.toLowerCase(),
      fullName: effectiveFullName,
      systemRole: user?.system_role || "USER"
    };
    const tokenJwt = generateToken(authUser, inv.school_id, inv.role);
    logAudit({
      schoolId: inv.school_id,
      userId,
      action: "INVITATION_ACCEPTED",
      entityType: "INVITATION",
      entityId: inv.id,
      newValues: { email: inv.email, role: inv.role, schoolId: inv.school_id },
      ipAddress: req.ip
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
        role: inv.role
      }
    });
  } catch (err) {
    db.exec("ROLLBACK;");
    return res.status(500).json({ success: false, error: "SERVER_ERROR", message: "Failed to activate account." });
  }
});
authRoutes.post("/device-token", authenticate, (req, res) => {
  const userId = req.user.id;
  const { token, platform } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: "VALIDATION_ERROR", message: "token is required." });
  }
  const effectivePlatform = ["ANDROID", "IOS", "WEB"].includes(platform?.toUpperCase()) ? platform.toUpperCase() : "ANDROID";
  const tokenId = `tok_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  db.prepare(`
    INSERT INTO device_tokens (id, user_id, token, platform, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, token) DO UPDATE SET platform = excluded.platform, updated_at = datetime('now')
  `).run(tokenId, userId, token.trim(), effectivePlatform);
  return res.json({ success: true, message: "Device token registered successfully." });
});
authRoutes.post("/forgot-password", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ success: false, error: "VALIDATION_ERROR", message: "Valid email is required." });
  }
  const rateLimitKey = `${ip}_${email.trim().toLowerCase()}`;
  if (!checkPasswordResetRateLimit(rateLimitKey)) {
    return res.status(429).json({
      success: false,
      error: "RATE_LIMIT_EXCEEDED",
      message: "Too many password reset requests. Please wait 1 hour before attempting again."
    });
  }
  const user = db.prepare("SELECT id, email, full_name, is_active FROM users WHERE LOWER(email) = LOWER(?)").get(email.trim());
  if (user && user.is_active) {
    const rawResetToken = crypto3.randomBytes(32).toString("hex");
    const tokenHash = crypto3.createHash("sha256").update(rawResetToken).digest("hex");
    const resetId = `rst_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1e3).toISOString();
    db.prepare(`
      INSERT INTO school_invitations (id, school_id, email, full_name, role, token_hash, token_hint, invited_by_user_id, status, delivery_status, expires_at)
      VALUES (?, 'sch_dps_rkp', ?, ?, 'PASSWORD_RESET', ?, 'rst_hint', ?, 'PENDING', 'DISABLED_NO_GATEWAY', ?)
    `).run(resetId, user.email, user.full_name, tokenHash, user.id, expiresAt);
    logAudit({
      userId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      entityType: "USER",
      entityId: user.id,
      ipAddress: ip
    });
  }
  return res.json({
    success: true,
    message: "If the provided email is registered, password reset instructions have been dispatched."
  });
});
authRoutes.post("/reset-password", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const { token, newPassword } = req.body;
  if (!checkPasswordResetRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: "RATE_LIMIT_EXCEEDED",
      message: "Too many password reset attempts. Please wait 1 hour before attempting again."
    });
  }
  if (!token || !newPassword) {
    return res.status(400).json({ success: false, error: "VALIDATION_ERROR", message: "Token and newPassword are required." });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ success: false, error: "WEAK_PASSWORD", message: "Password must be at least 8 characters long." });
  }
  const tokenHash = crypto3.createHash("sha256").update(token.trim()).digest("hex");
  const record = db.prepare("SELECT * FROM school_invitations WHERE token_hash = ? AND role = 'PASSWORD_RESET' AND status = 'PENDING'").get(tokenHash);
  if (!record || new Date(record.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ success: false, error: "INVALID_OR_EXPIRED_TOKEN", message: "Password reset token is invalid or has expired." });
  }
  const newHash = await hashPassword(newPassword);
  db.exec("BEGIN TRANSACTION;");
  try {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE LOWER(email) = LOWER(?)").run(newHash, record.email);
    db.prepare("UPDATE school_invitations SET status = 'ACCEPTED', updated_at = datetime('now') WHERE id = ?").run(record.id);
    db.exec("COMMIT;");
    logAudit({
      action: "PASSWORD_RESET_COMPLETED",
      entityType: "USER",
      entityId: record.invited_by_user_id,
      ipAddress: ip
    });
    return res.json({ success: true, message: "Password has been reset successfully. Please log in with your new password." });
  } catch (err) {
    db.exec("ROLLBACK;");
    return formatSafeServerError(res, err, "RESET_PASSWORD");
  }
});

// src/server/routes/schoolRoutes.ts
import crypto4 from "node:crypto";
import { Router as Router2 } from "express";
var schoolRoutes = Router2();
function hashInvitationToken(token) {
  return crypto4.createHash("sha256").update(token).digest("hex");
}
schoolRoutes.get("/", authenticate, (req, res) => {
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    const schools2 = db.prepare(`
        SELECT s.id, s.code, s.name, s.city, s.state, s.status, sm.role
        FROM schools s
        JOIN school_memberships sm ON s.id = sm.school_id
        WHERE sm.user_id = ? AND sm.status = 'ACTIVE'
        ORDER BY s.name ASC
      `).all(req.user.id);
    return res.json({ success: true, schools: schools2, totalCount: schools2.length });
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const statusFilter = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "ALL";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
  const offset = (page - 1) * limit;
  const whereClauses = [];
  const params = [];
  if (search) {
    whereClauses.push("(LOWER(s.name) LIKE ? OR LOWER(s.code) LIKE ? OR LOWER(s.city) LIKE ? OR LOWER(s.contact_email) LIKE ?)");
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term, term, term);
  }
  if (statusFilter && statusFilter !== "ALL") {
    whereClauses.push("s.status = ?");
    params.push(statusFilter);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM schools s ${whereSql}`).get(...params);
  const totalCount = countRow ? countRow.total : 0;
  const queryParams = [...params, limit, offset];
  const schools = db.prepare(`
      SELECT 
        s.id,
        s.code,
        s.name,
        s.affiliation_number,
        s.board,
        s.address,
        s.city,
        s.state,
        s.pincode,
        s.contact_phone,
        s.contact_email,
        s.contact_person,
        s.timezone,
        s.status,
        s.created_at,
        s.updated_at,
        (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.status = 'ACTIVE') as student_count,
        (SELECT COUNT(*) FROM vehicles v WHERE v.school_id = s.id AND v.status = 'ACTIVE') as vehicle_count,
        (SELECT COUNT(*) FROM drivers d WHERE d.school_id = s.id AND d.status = 'ACTIVE') as driver_count,
        (SELECT COUNT(*) FROM trips t WHERE t.school_id = s.id AND t.status = 'IN_PROGRESS') as active_trips_count,
        (SELECT COUNT(*) FROM school_memberships sm 
           JOIN users u ON sm.user_id = u.id 
           WHERE sm.school_id = s.id AND sm.role = 'SCHOOL_ADMIN' AND sm.status = 'ACTIVE' AND u.is_active = 1
        ) as active_admin_count,
        (SELECT COUNT(*) FROM school_memberships sm 
           WHERE sm.school_id = s.id AND sm.role = 'SCHOOL_ADMIN'
        ) as total_admin_count,
        (SELECT COUNT(*) FROM school_invitations si 
           WHERE si.school_id = s.id AND si.status = 'PENDING' AND si.expires_at > datetime('now')
        ) as pending_invitation_count,
        sub.plan_name, 
        sub.status as subscription_status, 
        sub.expires_at as subscription_expiry
      FROM schools s
      LEFT JOIN subscriptions sub ON s.id = sub.school_id
      ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...queryParams);
  return res.json({
    success: true,
    schools,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1
    }
  });
});
schoolRoutes.post("/", authenticate, (req, res) => {
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    return res.status(403).json({
      success: false,
      error: "FORBIDDEN",
      message: "Only Platform Administrators can register new schools."
    });
  }
  const {
    name,
    code,
    affiliationNumber,
    board,
    address,
    city,
    state,
    pincode,
    contactPhone,
    contactEmail,
    contactPerson,
    status,
    initialAdminEmail,
    initialAdminName,
    initialAdminPhone
  } = req.body;
  const schoolName = (name || "").trim();
  const schoolCode = (code || "").trim().toUpperCase();
  const schoolCity = (city || "").trim();
  const schoolState = (state || "Delhi").trim();
  const schoolPincode = (pincode || "").trim();
  const schoolAddress = (address || "").trim();
  const schoolPhone = (contactPhone || "").trim();
  const schoolEmail = (contactEmail || "").trim().toLowerCase();
  const schoolContactPerson = (contactPerson || "").trim();
  const schoolBoard = (board || "CBSE").trim();
  const schoolStatus = ["ACTIVE", "SUSPENDED", "TRIAL"].includes(status) ? status : "ACTIVE";
  const missing = [];
  if (!schoolName) missing.push("School Name");
  if (!schoolCode) missing.push("School Code");
  if (!schoolAddress) missing.push("Address");
  if (!schoolCity) missing.push("City");
  if (!schoolPincode) missing.push("Pincode");
  if (!schoolPhone) missing.push("Contact Phone");
  if (!schoolEmail) missing.push("Contact Email");
  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: `Missing required school fields: ${missing.join(", ")}.`
    });
  }
  if (!/^[A-Z0-9-]{2,15}$/.test(schoolCode)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_CODE_FORMAT",
      message: "School code must be 2-15 uppercase alphanumeric characters (hyphens allowed)."
    });
  }
  const existing = db.prepare("SELECT id FROM schools WHERE UPPER(code) = ?").get(schoolCode);
  if (existing) {
    return res.status(409).json({
      success: false,
      error: "SCHOOL_CODE_EXISTS",
      message: `School code "${schoolCode}" is already in use. Please provide a unique identifier.`
    });
  }
  const schoolId = `sch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  db.exec("BEGIN TRANSACTION;");
  try {
    db.prepare(`
      INSERT INTO schools (
        id, code, name, affiliation_number, board, address, city, state, pincode,
        contact_phone, contact_email, contact_person, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      schoolId,
      schoolCode,
      schoolName,
      affiliationNumber || null,
      schoolBoard,
      schoolAddress,
      schoolCity,
      schoolState,
      schoolPincode,
      schoolPhone,
      schoolEmail,
      schoolContactPerson || null,
      schoolStatus
    );
    db.prepare(`
      INSERT INTO tenant_settings (school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance, strict_reconciliation_required)
      VALUES (?, 45, 50, 1, 1)
    `).run(schoolId);
    db.prepare(`
      INSERT INTO subscriptions (id, school_id, plan_name, status, max_vehicles, max_students, expires_at)
      VALUES (?, ?, 'PROFESSIONAL', 'ACTIVE', 30, 1500, date('now', '+1 year'))
    `).run(`sub_${schoolId}`, schoolId);
    let initialInvitation = null;
    if (initialAdminEmail && initialAdminName) {
      const rawToken = crypto4.randomBytes(32).toString("hex");
      const tokenHash = hashInvitationToken(rawToken);
      const tokenHint = `inv_${rawToken.slice(0, 6)}...`;
      const invId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
      db.prepare(`
        INSERT INTO school_invitations (
          id, school_id, email, full_name, role, token_hash, token_hint,
          invited_by_user_id, status, delivery_status, delivery_provider, last_sent_at, expires_at
        )
        VALUES (?, ?, ?, ?, 'SCHOOL_ADMIN', ?, ?, ?, 'PENDING', 'DISABLED_NO_GATEWAY', 'SURAKSHAVAHAN_INTERNAL', datetime('now'), ?)
      `).run(
        invId,
        schoolId,
        initialAdminEmail.trim().toLowerCase(),
        initialAdminName.trim(),
        tokenHash,
        tokenHint,
        req.user.id,
        expiresAt
      );
      initialInvitation = {
        id: invId,
        email: initialAdminEmail.trim().toLowerCase(),
        fullName: initialAdminName.trim(),
        token: rawToken,
        deliveryStatus: "DISABLED_NO_GATEWAY",
        expiresAt
      };
    }
    db.exec("COMMIT;");
    logAudit({
      schoolId,
      userId: req.user.id,
      action: "SCHOOL_CREATED",
      entityType: "SCHOOL",
      entityId: schoolId,
      newValues: {
        code: schoolCode,
        name: schoolName,
        status: schoolStatus,
        city: schoolCity,
        contactEmail: schoolEmail
      },
      ipAddress: req.ip
    });
    const createdSchool = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
    return res.status(201).json({
      success: true,
      message: `School "${schoolName}" registered successfully.`,
      school: createdSchool,
      initialInvitation
    });
  } catch (err) {
    db.exec("ROLLBACK;");
    console.error("[Create School Error]", err?.message || "[REDACTED_ERROR]");
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
      message: "Failed to create school record. Transaction rolled back."
    });
  }
});
schoolRoutes.get(
  "/current",
  authenticate,
  requireSchoolContext(),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
    if (!school) {
      return res.status(404).json({ success: false, error: "SCHOOL_NOT_FOUND" });
    }
    const settings = db.prepare("SELECT * FROM tenant_settings WHERE school_id = ?").get(schoolId);
    const subscription = db.prepare("SELECT * FROM subscriptions WHERE school_id = ?").get(schoolId);
    const stats = {
      totalVehicles: db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE school_id = ? AND status != 'RETIRED'").get(schoolId).c,
      totalDrivers: db.prepare("SELECT COUNT(*) as c FROM drivers WHERE school_id = ? AND status = 'ACTIVE'").get(schoolId).c,
      totalStudents: db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ? AND status = 'ACTIVE'").get(schoolId).c,
      totalRoutes: db.prepare("SELECT COUNT(*) as c FROM routes WHERE school_id = ? AND is_active = 1").get(schoolId).c,
      activeTrips: db.prepare("SELECT COUNT(*) as c FROM trips WHERE school_id = ? AND status = 'IN_PROGRESS'").get(schoolId).c,
      todayCompletedTrips: db.prepare("SELECT COUNT(*) as c FROM trips WHERE school_id = ? AND status = 'COMPLETED' AND trip_date = date('now')").get(schoolId).c,
      todayAttendanceScans: db.prepare("SELECT COUNT(*) as c FROM attendance_events WHERE school_id = ? AND date(scanned_at) = date('now')").get(schoolId).c
    };
    return res.json({
      success: true,
      school,
      settings: settings || {},
      subscription: subscription || { plan_name: "PROFESSIONAL", status: "ACTIVE", max_vehicles: 20, max_students: 1e3 },
      stats
    });
  }
);
schoolRoutes.get("/:id", authenticate, (req, res) => {
  const targetSchoolId = req.params.id;
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    const membership = db.prepare("SELECT id FROM school_memberships WHERE user_id = ? AND school_id = ? AND status = ?").get(req.user.id, targetSchoolId, "ACTIVE");
    if (!membership) {
      return res.status(403).json({
        success: false,
        error: "TENANT_ACCESS_DENIED",
        message: "Access denied: You are not authorized to view this school."
      });
    }
  }
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(targetSchoolId);
  if (!school) {
    return res.status(404).json({ success: false, error: "SCHOOL_NOT_FOUND", message: "School does not exist." });
  }
  const settings = db.prepare("SELECT * FROM tenant_settings WHERE school_id = ?").get(targetSchoolId);
  const subscription = db.prepare("SELECT * FROM subscriptions WHERE school_id = ?").get(targetSchoolId);
  const administrators = db.prepare(`
      SELECT 
        u.id as user_id,
        u.email,
        u.full_name,
        u.phone,
        u.is_active as user_active,
        u.created_at as user_created_at,
        sm.id as membership_id,
        sm.role,
        sm.status as membership_status,
        sm.created_at as assigned_at
      FROM school_memberships sm
      JOIN users u ON sm.user_id = u.id
      WHERE sm.school_id = ? AND sm.role IN ('SCHOOL_ADMIN', 'TRANSPORT_MANAGER')
      ORDER BY sm.created_at DESC
    `).all(targetSchoolId);
  const invitations = db.prepare(`
      SELECT 
        id,
        school_id,
        email,
        full_name,
        role,
        token_hint,
        status,
        delivery_status,
        delivery_provider,
        last_sent_at,
        expires_at,
        created_at
      FROM school_invitations
      WHERE school_id = ?
      ORDER BY created_at DESC
    `).all(targetSchoolId);
  const stats = {
    totalStudents: db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ?").get(targetSchoolId)?.c || 0,
    totalVehicles: db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE school_id = ? AND status != 'RETIRED'").get(targetSchoolId)?.c || 0,
    totalDrivers: db.prepare("SELECT COUNT(*) as c FROM drivers WHERE school_id = ? AND status = 'ACTIVE'").get(targetSchoolId)?.c || 0,
    totalRoutes: db.prepare("SELECT COUNT(*) as c FROM routes WHERE school_id = ?").get(targetSchoolId)?.c || 0,
    activeTrips: db.prepare("SELECT COUNT(*) as c FROM trips WHERE school_id = ? AND status = 'IN_PROGRESS'").get(targetSchoolId)?.c || 0
  };
  const auditHistory = db.prepare(`
      SELECT id, action, entity_type, entity_id, user_id, ip_address, created_at, new_values
      FROM audit_logs
      WHERE school_id = ?
      ORDER BY created_at DESC
      LIMIT 25
    `).all(targetSchoolId);
  return res.json({
    success: true,
    school,
    settings: settings || {},
    subscription: subscription || { plan_name: "PROFESSIONAL", status: "ACTIVE" },
    administrators,
    invitations,
    stats,
    auditHistory
  });
});
schoolRoutes.put("/:id", authenticate, (req, res) => {
  const targetSchoolId = req.params.id;
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    const membership = db.prepare("SELECT id FROM school_memberships WHERE user_id = ? AND school_id = ? AND role = 'SCHOOL_ADMIN' AND status = 'ACTIVE'").get(req.user.id, targetSchoolId);
    if (!membership) {
      return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Unauthorized to edit this school." });
    }
  }
  const existingSchool = db.prepare("SELECT * FROM schools WHERE id = ?").get(targetSchoolId);
  if (!existingSchool) {
    return res.status(404).json({ success: false, error: "SCHOOL_NOT_FOUND", message: "School not found" });
  }
  const {
    name,
    affiliationNumber,
    board,
    address,
    city,
    state,
    pincode,
    contactPhone,
    contactEmail,
    contactPerson,
    timezone
  } = req.body;
  const updatedName = (name || existingSchool.name).trim();
  const updatedAddress = (address || existingSchool.address).trim();
  const updatedCity = (city || existingSchool.city).trim();
  const updatedState = (state || existingSchool.state).trim();
  const updatedPincode = (pincode || existingSchool.pincode).trim();
  const updatedPhone = (contactPhone || existingSchool.contact_phone).trim();
  const updatedEmail = (contactEmail || existingSchool.contact_email).trim().toLowerCase();
  const updatedPerson = contactPerson !== void 0 ? contactPerson.trim() : existingSchool.contact_person;
  const updatedBoard = board || existingSchool.board;
  const updatedAffiliation = affiliationNumber !== void 0 ? affiliationNumber : existingSchool.affiliation_number;
  const updatedTz = timezone || existingSchool.timezone || "Asia/Kolkata";
  db.prepare(`
    UPDATE schools SET
      name = ?,
      affiliation_number = ?,
      board = ?,
      address = ?,
      city = ?,
      state = ?,
      pincode = ?,
      contact_phone = ?,
      contact_email = ?,
      contact_person = ?,
      timezone = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updatedName,
    updatedAffiliation,
    updatedBoard,
    updatedAddress,
    updatedCity,
    updatedState,
    updatedPincode,
    updatedPhone,
    updatedEmail,
    updatedPerson,
    updatedTz,
    targetSchoolId
  );
  logAudit({
    schoolId: targetSchoolId,
    userId: req.user.id,
    action: "SCHOOL_UPDATED",
    entityType: "SCHOOL",
    entityId: targetSchoolId,
    oldValues: { name: existingSchool.name, city: existingSchool.city, contactEmail: existingSchool.contact_email },
    newValues: { name: updatedName, city: updatedCity, contactEmail: updatedEmail, contactPerson: updatedPerson },
    ipAddress: req.ip
  });
  const updated = db.prepare("SELECT * FROM schools WHERE id = ?").get(targetSchoolId);
  return res.json({ success: true, message: "School updated successfully", school: updated });
});
schoolRoutes.patch("/:id/status", authenticate, (req, res) => {
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Platform Admin permissions required" });
  }
  const targetSchoolId = req.params.id;
  const { status } = req.body;
  if (!["ACTIVE", "SUSPENDED", "TRIAL"].includes(status)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_STATUS",
      message: "Status must be one of: ACTIVE, SUSPENDED, TRIAL"
    });
  }
  const existing = db.prepare("SELECT status, name FROM schools WHERE id = ?").get(targetSchoolId);
  if (!existing) {
    return res.status(404).json({ success: false, error: "SCHOOL_NOT_FOUND", message: "School not found" });
  }
  db.prepare("UPDATE schools SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, targetSchoolId);
  logAudit({
    schoolId: targetSchoolId,
    userId: req.user.id,
    action: "SCHOOL_STATUS_CHANGED",
    entityType: "SCHOOL",
    entityId: targetSchoolId,
    oldValues: { status: existing.status },
    newValues: { status },
    ipAddress: req.ip
  });
  return res.json({
    success: true,
    message: `School "${existing.name}" status updated to ${status}.`,
    status
  });
});
schoolRoutes.post("/:id/admins", authenticate, async (req, res) => {
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Platform Admin permissions required" });
  }
  const targetSchoolId = req.params.id;
  const school = db.prepare("SELECT id, name FROM schools WHERE id = ?").get(targetSchoolId);
  if (!school) {
    return res.status(404).json({ success: false, error: "SCHOOL_NOT_FOUND", message: "School does not exist." });
  }
  const { email, fullName, phone, password } = req.body;
  const effectiveEmail = (email || "").trim().toLowerCase();
  const effectiveName = (fullName || "").trim();
  const effectivePhone = (phone || "").trim();
  const effectivePassword = (password || "").trim();
  if (!effectiveEmail || !effectiveName || !effectivePassword) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "Full Name, Email, and Password are required."
    });
  }
  if (effectivePassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: "WEAK_PASSWORD",
      message: "Password must be at least 8 characters long."
    });
  }
  db.exec("BEGIN TRANSACTION;");
  try {
    let user = db.prepare("SELECT id, email, is_active FROM users WHERE LOWER(email) = ?").get(effectiveEmail);
    let userId = user?.id;
    if (!user) {
      userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const passwordHash = await hashPassword(effectivePassword);
      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active, email_verified)
        VALUES (?, ?, ?, ?, ?, 'USER', 1, 1)
      `).run(userId, effectiveEmail, passwordHash, effectiveName, effectivePhone || null);
    } else {
      db.prepare("UPDATE users SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(userId);
    }
    const existingMembership = db.prepare("SELECT id, role, status FROM school_memberships WHERE user_id = ? AND school_id = ?").get(userId, targetSchoolId);
    let membershipId = existingMembership?.id;
    if (existingMembership) {
      if (existingMembership.status === "ACTIVE" && existingMembership.role === "SCHOOL_ADMIN") {
        db.exec("ROLLBACK;");
        return res.status(409).json({
          success: false,
          error: "ADMIN_ALREADY_EXISTS",
          message: `${effectiveEmail} is already an active School Admin for ${school.name}.`
        });
      }
      db.prepare("UPDATE school_memberships SET role = 'SCHOOL_ADMIN', status = 'ACTIVE' WHERE id = ?").run(membershipId);
    } else {
      membershipId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.prepare(`
        INSERT INTO school_memberships (id, user_id, school_id, role, status)
        VALUES (?, ?, ?, 'SCHOOL_ADMIN', 'ACTIVE')
      `).run(membershipId, userId, targetSchoolId);
    }
    db.exec("COMMIT;");
    logAudit({
      schoolId: targetSchoolId,
      userId: req.user.id,
      action: "ADMIN_CREATED",
      entityType: "USER",
      entityId: userId,
      newValues: { email: effectiveEmail, fullName: effectiveName, role: "SCHOOL_ADMIN" },
      ipAddress: req.ip
    });
    return res.status(201).json({
      success: true,
      message: `School Administrator account for ${effectiveName} created successfully.`,
      user: {
        userId,
        email: effectiveEmail,
        fullName: effectiveName,
        phone: effectivePhone,
        role: "SCHOOL_ADMIN",
        status: "ACTIVE"
      }
    });
  } catch (err) {
    db.exec("ROLLBACK;");
    console.error("[Create Admin Error]", err?.message || "[REDACTED_ERROR]");
    return res.status(500).json({ success: false, error: "SERVER_ERROR", message: "Failed to create administrator account." });
  }
});
schoolRoutes.post("/:id/admins/invite", authenticate, (req, res) => {
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Platform Admin permissions required" });
  }
  const targetSchoolId = req.params.id;
  const school = db.prepare("SELECT id, name, code FROM schools WHERE id = ?").get(targetSchoolId);
  if (!school) {
    return res.status(404).json({ success: false, error: "SCHOOL_NOT_FOUND", message: "School not found" });
  }
  const { email, fullName, role } = req.body;
  const effectiveEmail = (email || "").trim().toLowerCase();
  const effectiveName = (fullName || "").trim();
  const targetRole = role === "TRANSPORT_MANAGER" ? "TRANSPORT_MANAGER" : "SCHOOL_ADMIN";
  if (!effectiveEmail || !effectiveName) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "Both Administrator Email and Full Name are required."
    });
  }
  const activeAdmin = db.prepare(`
      SELECT u.id 
      FROM users u
      JOIN school_memberships sm ON u.id = sm.user_id
      WHERE LOWER(u.email) = ? AND sm.school_id = ? AND sm.status = 'ACTIVE'
    `).get(effectiveEmail, targetSchoolId);
  if (activeAdmin) {
    return res.status(409).json({
      success: false,
      error: "ADMIN_ALREADY_ASSIGNED",
      message: `${effectiveEmail} is already an active member of this school.`
    });
  }
  const rawToken = crypto4.randomBytes(32).toString("hex");
  const tokenHash = hashInvitationToken(rawToken);
  const tokenHint = `inv_${rawToken.substring(0, 8)}...`;
  const invId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
  db.prepare(`
    UPDATE school_invitations 
    SET status = 'REVOKED', updated_at = datetime('now')
    WHERE school_id = ? AND LOWER(email) = ? AND status = 'PENDING'
  `).run(targetSchoolId, effectiveEmail);
  const emailGatewayConfigured = Boolean(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY);
  const deliveryStatus = emailGatewayConfigured ? "DELIVERED_EMAIL" : "DISABLED_NO_GATEWAY";
  db.prepare(`
    INSERT INTO school_invitations (
      id, school_id, email, full_name, role, token_hash, token_hint,
      invited_by_user_id, status, delivery_status, delivery_provider, last_sent_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 'SURAKSHAVAHAN_INTERNAL', datetime('now'), ?)
  `).run(
    invId,
    targetSchoolId,
    effectiveEmail,
    effectiveName,
    targetRole,
    tokenHash,
    tokenHint,
    req.user.id,
    deliveryStatus,
    expiresAt
  );
  logAudit({
    schoolId: targetSchoolId,
    userId: req.user.id,
    action: "ADMIN_INVITED",
    entityType: "INVITATION",
    entityId: invId,
    newValues: { email: effectiveEmail, fullName: effectiveName, role: targetRole, deliveryStatus },
    ipAddress: req.ip
  });
  return res.status(201).json({
    success: true,
    message: `Invitation generated for ${effectiveName} (${effectiveEmail}).`,
    invitation: {
      id: invId,
      email: effectiveEmail,
      fullName: effectiveName,
      role: targetRole,
      token: rawToken,
      inviteUrl: `/accept-invite?token=${rawToken}`,
      deliveryStatus,
      expiresAt
    }
  });
});
schoolRoutes.post("/:id/admins/:userId/status", authenticate, (req, res) => {
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Platform Admin permissions required" });
  }
  const { id: targetSchoolId, userId: targetUserId } = req.params;
  const { status } = req.body;
  if (!["ACTIVE", "INACTIVE"].includes(status)) {
    return res.status(400).json({ success: false, error: "INVALID_STATUS", message: "Status must be ACTIVE or INACTIVE" });
  }
  const membership = db.prepare("SELECT id, status, role FROM school_memberships WHERE user_id = ? AND school_id = ?").get(targetUserId, targetSchoolId);
  if (!membership) {
    return res.status(404).json({ success: false, error: "MEMBERSHIP_NOT_FOUND", message: "Admin membership not found" });
  }
  db.prepare("UPDATE school_memberships SET status = ? WHERE user_id = ? AND school_id = ?").run(
    status,
    targetUserId,
    targetSchoolId
  );
  logAudit({
    schoolId: targetSchoolId,
    userId: req.user.id,
    action: "ADMIN_STATUS_CHANGED",
    entityType: "SCHOOL_MEMBERSHIP",
    entityId: membership.id,
    oldValues: { status: membership.status },
    newValues: { status },
    ipAddress: req.ip
  });
  return res.json({
    success: true,
    message: `Administrator membership is now ${status}.`,
    membershipStatus: status
  });
});
schoolRoutes.post("/:id/invitations/:invId/revoke", authenticate, (req, res) => {
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Platform Admin permissions required" });
  }
  const { id: targetSchoolId, invId } = req.params;
  const inv = db.prepare("SELECT id, email, status FROM school_invitations WHERE id = ? AND school_id = ?").get(invId, targetSchoolId);
  if (!inv) {
    return res.status(404).json({ success: false, error: "INVITATION_NOT_FOUND", message: "Invitation not found" });
  }
  db.prepare("UPDATE school_invitations SET status = 'REVOKED', updated_at = datetime('now') WHERE id = ?").run(invId);
  logAudit({
    schoolId: targetSchoolId,
    userId: req.user.id,
    action: "INVITATION_REVOKED",
    entityType: "INVITATION",
    entityId: invId,
    newValues: { status: "REVOKED" },
    ipAddress: req.ip
  });
  return res.json({ success: true, message: `Invitation for ${inv.email} has been revoked.` });
});
schoolRoutes.post("/:id/invitations/:invId/resend", authenticate, (req, res) => {
  if (req.user?.systemRole !== "PLATFORM_ADMIN") {
    return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Platform Admin permissions required" });
  }
  const { id: targetSchoolId, invId } = req.params;
  const inv = db.prepare("SELECT id, email, full_name, role, last_sent_at, status FROM school_invitations WHERE id = ? AND school_id = ?").get(invId, targetSchoolId);
  if (!inv) {
    return res.status(404).json({ success: false, error: "INVITATION_NOT_FOUND", message: "Invitation not found" });
  }
  if (inv.last_sent_at) {
    const elapsedSeconds = (Date.now() - new Date(inv.last_sent_at).getTime()) / 1e3;
    if (elapsedSeconds < 30) {
      return res.status(429).json({
        success: false,
        error: "RESEND_COOLDOWN",
        message: `Please wait ${Math.ceil(30 - elapsedSeconds)}s before resending this invitation.`
      });
    }
  }
  const rawToken = crypto4.randomBytes(32).toString("hex");
  const tokenHash = hashInvitationToken(rawToken);
  const tokenHint = `inv_${rawToken.substring(0, 8)}...`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
  db.prepare(`
    UPDATE school_invitations SET
      token_hash = ?,
      token_hint = ?,
      status = 'PENDING',
      expires_at = ?,
      last_sent_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(tokenHash, tokenHint, expiresAt, invId);
  logAudit({
    schoolId: targetSchoolId,
    userId: req.user.id,
    action: "INVITATION_RESENT",
    entityType: "INVITATION",
    entityId: invId,
    newValues: { resendAt: (/* @__PURE__ */ new Date()).toISOString() },
    ipAddress: req.ip
  });
  return res.json({
    success: true,
    message: `Fresh invitation generated for ${inv.email}.`,
    invitation: {
      id: invId,
      email: inv.email,
      fullName: inv.full_name,
      token: rawToken,
      inviteUrl: `/accept-invite?token=${rawToken}`,
      expiresAt
    }
  });
});
schoolRoutes.put(
  "/settings",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const {
      speedLimitKmh,
      geofenceBufferMeters,
      allowManualAttendance,
      strictReconciliationRequired,
      smsNotificationsEnabled,
      whatsappNotificationsEnabled
    } = req.body;
    db.prepare(`
      INSERT INTO tenant_settings (
        school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance,
        strict_reconciliation_required, sms_notifications_enabled, whatsapp_notifications_enabled, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(school_id) DO UPDATE SET
        speed_limit_kmh = excluded.speed_limit_kmh,
        geofence_buffer_meters = excluded.geofence_buffer_meters,
        allow_manual_attendance = excluded.allow_manual_attendance,
        strict_reconciliation_required = excluded.strict_reconciliation_required,
        sms_notifications_enabled = excluded.sms_notifications_enabled,
        whatsapp_notifications_enabled = excluded.whatsapp_notifications_enabled,
        updated_at = datetime('now')
    `).run(
      schoolId,
      speedLimitKmh ?? 45,
      geofenceBufferMeters ?? 50,
      allowManualAttendance ? 1 : 0,
      strictReconciliationRequired ? 1 : 0,
      smsNotificationsEnabled ? 1 : 0,
      whatsappNotificationsEnabled ? 1 : 0
    );
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: "UPDATE_SETTINGS",
      entityType: "TENANT_SETTINGS",
      entityId: schoolId,
      newValues: req.body
    });
    return res.json({ success: true, message: "Settings saved successfully" });
  }
);

// src/server/routes/studentRoutes.ts
import { Router as Router3 } from "express";
import crypto5 from "crypto";
import QRCode from "qrcode";
var studentRoutes = Router3();
studentRoutes.get("/", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const search = (req.query.search || "").trim();
  const grade = (req.query.grade || "").trim();
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10)));
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
  const params = [schoolId];
  if (search) {
    query += ` AND (LOWER(s.full_name) LIKE ? OR LOWER(s.admission_number) LIKE ? OR s.emergency_phone LIKE ?)`;
    const searchPattern = `%${search.toLowerCase()}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }
  if (grade) {
    query += ` AND s.grade = ?`;
    params.push(grade);
  }
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM (${query})`).get(...params);
  query += ` ORDER BY s.grade ASC, s.section ASC, s.full_name ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  const students = db.prepare(query).all(...params);
  return res.json({
    success: true,
    students,
    pagination: {
      page,
      limit,
      total: countRow.total,
      totalPages: Math.ceil(countRow.total / limit)
    }
  });
});
studentRoutes.get("/:id", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const student = db.prepare(`
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
    `).get(req.params.id, schoolId);
  if (!student) {
    return res.status(404).json({ success: false, error: "STUDENT_NOT_FOUND" });
  }
  const guardians = db.prepare(`
      SELECT g.*, sg.is_primary, sg.can_pickup, sg.relationship_type
      FROM student_guardians sg
      JOIN guardians g ON sg.guardian_id = g.id
      WHERE sg.student_id = ?
    `).all(student.id);
  const qrCredential = db.prepare("SELECT id, token_hint, issued_at, expires_at, is_revoked FROM qr_credentials WHERE student_id = ? AND is_revoked = 0").get(student.id);
  const recentAttendance = db.prepare(`
      SELECT ae.*, r.name as route_name, rs.stop_name, u.full_name as scanned_by_name
      FROM attendance_events ae
      JOIN trips t ON ae.trip_id = t.id
      JOIN routes r ON t.route_id = r.id
      LEFT JOIN route_stops rs ON ae.stop_id = rs.id
      LEFT JOIN users u ON ae.scanned_by_user_id = u.id
      WHERE ae.student_id = ? AND ae.school_id = ?
      ORDER BY ae.scanned_at DESC
      LIMIT 10
    `).all(student.id, schoolId);
  return res.json({
    success: true,
    student,
    guardians,
    qrCredential,
    recentAttendance
  });
});
studentRoutes.post(
  "/",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  async (req, res) => {
    const schoolId = req.schoolContext.schoolId;
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
      eveningStopId
    } = req.body;
    if (!admissionNumber || !fullName || !grade || !section || !emergencyPhone) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Admission number, full name, grade, section, and emergency contact phone are required"
      });
    }
    const existing = db.prepare("SELECT id FROM students WHERE school_id = ? AND LOWER(admission_number) = LOWER(?)").get(schoolId, admissionNumber.trim());
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "ADMISSION_EXISTS",
        message: `Student with admission number "${admissionNumber}" already exists in this school.`
      });
    }
    const studentId = `stu_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.exec("BEGIN TRANSACTION;");
    try {
      db.prepare(`
        INSERT INTO students (id, school_id, admission_number, full_name, grade, section, blood_group, emergency_phone, home_address, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
      `).run(
        studentId,
        schoolId,
        admissionNumber.trim().toUpperCase(),
        fullName.trim(),
        grade.trim(),
        section.trim().toUpperCase(),
        bloodGroup || "O+",
        emergencyPhone.trim(),
        homeAddress || null
      );
      if (morningRouteId || eveningRouteId) {
        db.prepare(`
          INSERT INTO transport_assignments (id, school_id, student_id, morning_route_id, morning_stop_id, evening_route_id, evening_stop_id, academic_year, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, '2026-2027', 1)
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
      const rawToken = `SVQR_${crypto5.randomBytes(24).toString("hex")}`;
      const tokenHash = crypto5.createHash("sha256").update(rawToken).digest("hex");
      const tokenHint = `SV-QR-${rawToken.substring(5, 9).toUpperCase()}`;
      db.prepare(`
        INSERT INTO qr_credentials (id, school_id, student_id, token_hash, token_hint, expires_at, is_revoked)
        VALUES (?, ?, ?, ?, ?, date('now', '+1 year'), 0)
      `).run(`qr_${studentId}`, schoolId, studentId, tokenHash, tokenHint);
      db.exec("COMMIT;");
      logAudit({
        schoolId,
        userId: req.user?.id,
        action: "CREATE_STUDENT",
        entityType: "STUDENT",
        entityId: studentId,
        newValues: { admissionNumber, fullName, grade, section }
      });
      return res.status(201).json({
        success: true,
        message: "Student registered successfully with transport and QR badge.",
        studentId
      });
    } catch (err) {
      db.exec("ROLLBACK;");
      return formatSafeServerError(res, err, "CREATE_STUDENT");
    }
  }
);
studentRoutes.put(
  "/:id",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const studentId = req.params.id;
    const existing = db.prepare("SELECT * FROM students WHERE id = ? AND school_id = ?").get(studentId, schoolId);
    if (!existing) {
      return res.status(404).json({ success: false, error: "STUDENT_NOT_FOUND" });
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
      eveningStopId
    } = req.body;
    db.exec("BEGIN TRANSACTION;");
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
        fullName,
        grade,
        section,
        bloodGroup,
        emergencyPhone,
        homeAddress,
        status,
        studentId,
        schoolId
      );
      if (morningRouteId !== void 0 || eveningRouteId !== void 0) {
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
      db.exec("COMMIT;");
      logAudit({
        schoolId,
        userId: req.user?.id,
        action: "UPDATE_STUDENT",
        entityType: "STUDENT",
        entityId: studentId,
        oldValues: existing,
        newValues: req.body
      });
      return res.json({ success: true, message: "Student updated successfully" });
    } catch (err) {
      db.exec("ROLLBACK;");
      return formatSafeServerError(res, err, "UPDATE_STUDENT");
    }
  }
);
studentRoutes.get("/:id/qr-badge", authenticate, requireSchoolContext(), async (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const studentId = req.params.id;
  if (req.schoolContext?.role === "PARENT") {
    const isLinked = db.prepare(`
        SELECT 1 FROM student_guardians sg
        JOIN guardians g ON sg.guardian_id = g.id
        WHERE sg.student_id = ? AND g.user_id = ?
      `).get(studentId, req.user.id);
    if (!isLinked) {
      return res.status(403).json({
        success: false,
        error: "ACCESS_DENIED",
        message: "DPDP Privacy Protection: You are only authorized to view QR badges for your own registered children."
      });
    }
  }
  const student = db.prepare("SELECT id, full_name, admission_number, grade, section, emergency_phone FROM students WHERE id = ? AND school_id = ?").get(studentId, schoolId);
  if (!student) {
    return res.status(404).json({ success: false, error: "STUDENT_NOT_FOUND" });
  }
  let credential = db.prepare("SELECT id, token_hash, token_hint, expires_at, is_revoked FROM qr_credentials WHERE student_id = ? AND is_revoked = 0").get(student.id);
  let rawToken = "";
  if (!credential) {
    rawToken = `SVQR_${crypto5.randomBytes(24).toString("hex")}`;
    const tokenHash = crypto5.createHash("sha256").update(rawToken).digest("hex");
    const tokenHint = `SV-QR-${rawToken.substring(5, 9).toUpperCase()}`;
    credential = {
      id: `qr_${student.id}`,
      token_hash: tokenHash,
      token_hint: tokenHint,
      expires_at: "2027-03-31",
      is_revoked: 0
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
      dark: "#1e293b",
      light: "#ffffff"
    }
  });
  return res.json({
    success: true,
    student,
    qrDataUrl,
    qrPayload,
    credential: {
      id: credential.id,
      tokenHint: credential.token_hint,
      expiresAt: credential.expires_at
    }
  });
});
studentRoutes.post(
  "/:id/revoke-qr",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const { reason } = req.body;
    db.prepare(`
      UPDATE qr_credentials SET
        is_revoked = 1,
        revoked_reason = ?,
        revoked_at = datetime('now')
      WHERE student_id = ? AND school_id = ? AND is_revoked = 0
    `).run(reason || "Reported lost/damaged badge", req.params.id, schoolId);
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: "REVOKE_QR_CREDENTIAL",
      entityType: "QR_CREDENTIAL",
      entityId: req.params.id,
      newValues: { reason }
    });
    return res.json({ success: true, message: "QR credential revoked. Please issue a new badge." });
  }
);

// src/server/routes/vehicleRoutes.ts
import { Router as Router4 } from "express";
var vehicleRoutes = Router4();
vehicleRoutes.get("/", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const vehicles = db.prepare(`
      SELECT v.*,
        (SELECT COUNT(*) FROM routes r WHERE r.default_vehicle_id = v.id AND r.is_active = 1) as assigned_routes_count,
        (SELECT t.id FROM trips t WHERE t.vehicle_id = v.id AND t.status = 'IN_PROGRESS' LIMIT 1) as active_trip_id,
        (SELECT bl.recorded_at FROM bus_locations bl WHERE bl.vehicle_id = v.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_gps_at
      FROM vehicles v
      WHERE v.school_id = ?
      ORDER BY v.bus_number ASC
    `).all(schoolId);
  return res.json({ success: true, vehicles });
});
vehicleRoutes.post(
  "/",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const {
      registrationNumber,
      busNumber,
      capacity,
      model,
      make,
      fuelType,
      fitnessExpiry,
      insuranceExpiry,
      gpsDeviceId
    } = req.body;
    if (!registrationNumber || !busNumber || !capacity) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Registration number, internal bus number, and seating capacity are required"
      });
    }
    const regClean = registrationNumber.trim().toUpperCase();
    const existing = db.prepare("SELECT id FROM vehicles WHERE school_id = ? AND UPPER(registration_number) = ?").get(schoolId, regClean);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "DUPLICATE_REGISTRATION",
        message: `Vehicle with registration "${regClean}" is already registered in this school.`
      });
    }
    const id = `veh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.prepare(`
      INSERT INTO vehicles (id, school_id, registration_number, bus_number, capacity, model, make, fuel_type, fitness_expiry, insurance_expiry, gps_device_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      id,
      schoolId,
      regClean,
      busNumber.trim(),
      parseInt(capacity, 10),
      model || "Standard School Bus",
      make || "Tata Motors",
      fuelType || "CNG",
      fitnessExpiry || null,
      insuranceExpiry || null,
      gpsDeviceId || null
    );
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: "CREATE_VEHICLE",
      entityType: "VEHICLE",
      entityId: id,
      newValues: { registrationNumber: regClean, busNumber, capacity }
    });
    return res.status(201).json({ success: true, message: "Vehicle added successfully", vehicleId: id });
  }
);
vehicleRoutes.put(
  "/:id",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const vehicleId = req.params.id;
    const existing = db.prepare("SELECT * FROM vehicles WHERE id = ? AND school_id = ?").get(vehicleId, schoolId);
    if (!existing) {
      return res.status(404).json({ success: false, error: "VEHICLE_NOT_FOUND" });
    }
    const {
      busNumber,
      capacity,
      model,
      make,
      fuelType,
      fitnessExpiry,
      insuranceExpiry,
      gpsDeviceId,
      status
    } = req.body;
    db.prepare(`
      UPDATE vehicles SET
        bus_number = COALESCE(?, bus_number),
        capacity = COALESCE(?, capacity),
        model = COALESCE(?, model),
        make = COALESCE(?, make),
        fuel_type = COALESCE(?, fuel_type),
        fitness_expiry = COALESCE(?, fitness_expiry),
        insurance_expiry = COALESCE(?, insurance_expiry),
        gps_device_id = COALESCE(?, gps_device_id),
        status = COALESCE(?, status),
        updated_at = datetime('now')
      WHERE id = ? AND school_id = ?
    `).run(
      busNumber,
      capacity ? parseInt(capacity, 10) : null,
      model,
      make,
      fuelType,
      fitnessExpiry,
      insuranceExpiry,
      gpsDeviceId,
      status,
      vehicleId,
      schoolId
    );
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: "UPDATE_VEHICLE",
      entityType: "VEHICLE",
      entityId: vehicleId,
      newValues: req.body
    });
    return res.json({ success: true, message: "Vehicle updated successfully" });
  }
);

// src/server/routes/driverRoutes.ts
import { Router as Router5 } from "express";
var driverRoutes = Router5();
driverRoutes.get("/", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const drivers = db.prepare(`
      SELECT d.*, u.email as user_email,
        (SELECT COUNT(*) FROM trips t WHERE t.driver_id = d.id AND t.status = 'IN_PROGRESS') as active_trips_count,
        (SELECT COUNT(*) FROM trips t WHERE t.driver_id = d.id AND t.status = 'COMPLETED') as total_completed_trips
      FROM drivers d
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.school_id = ?
      ORDER BY d.full_name ASC
    `).all(schoolId);
  return res.json({ success: true, drivers });
});
driverRoutes.post(
  "/",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  async (req, res) => {
    const schoolId = req.schoolContext.schoolId;
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
      loginPassword
    } = req.body;
    if (!fullName || !phone || !licenseNumber || !licenseExpiry) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Full name, phone, driving license number, and license expiry date are required"
      });
    }
    const cleanLic = licenseNumber.trim().toUpperCase();
    const existing = db.prepare("SELECT id FROM drivers WHERE school_id = ? AND UPPER(license_number) = ?").get(schoolId, cleanLic);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "DUPLICATE_LICENSE",
        message: `Driver with license "${cleanLic}" is already registered in this school.`
      });
    }
    const driverId = `drv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let userId = null;
    db.exec("BEGIN TRANSACTION;");
    try {
      if (email && loginPassword) {
        const cleanEmail = email.trim().toLowerCase();
        const existingUser = db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(cleanEmail);
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
        bloodGroup || "B+",
        yearsExperience ? parseInt(yearsExperience, 10) : 0
      );
      db.exec("COMMIT;");
      logAudit({
        schoolId,
        userId: req.user?.id,
        action: "CREATE_DRIVER",
        entityType: "DRIVER",
        entityId: driverId,
        newValues: { fullName, phone, licenseNumber: cleanLic }
      });
      return res.status(201).json({ success: true, message: "Driver registered successfully", driverId });
    } catch (err) {
      db.exec("ROLLBACK;");
      return formatSafeServerError(res, err, "CREATE_DRIVER");
    }
  }
);
driverRoutes.put(
  "/:id",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const driverId = req.params.id;
    const existing = db.prepare("SELECT * FROM drivers WHERE id = ? AND school_id = ?").get(driverId, schoolId);
    if (!existing) {
      return res.status(404).json({ success: false, error: "DRIVER_NOT_FOUND" });
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
      status
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
      action: "UPDATE_DRIVER",
      entityType: "DRIVER",
      entityId: driverId,
      newValues: req.body
    });
    return res.json({ success: true, message: "Driver updated successfully" });
  }
);

// src/server/routes/routeRoutes.ts
import { Router as Router6 } from "express";
var routeRoutes = Router6();
routeRoutes.get("/", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const routes = db.prepare(`
      SELECT r.*,
        v.bus_number, v.registration_number, v.capacity as vehicle_capacity,
        d.full_name as driver_name, d.phone as driver_phone,
        (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = r.id) as stops_count,
        (SELECT COUNT(*) FROM transport_assignments ta WHERE (ta.morning_route_id = r.id OR ta.evening_route_id = r.id) AND ta.is_active = 1) as assigned_students_count
      FROM routes r
      LEFT JOIN vehicles v ON r.default_vehicle_id = v.id
      LEFT JOIN drivers d ON r.default_driver_id = d.id
      WHERE r.school_id = ?
      ORDER BY r.route_code ASC
    `).all(schoolId);
  return res.json({ success: true, routes });
});
routeRoutes.get("/:id", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const route = db.prepare(`
      SELECT r.*,
        v.bus_number, v.registration_number, v.capacity as vehicle_capacity,
        d.full_name as driver_name, d.phone as driver_phone
      FROM routes r
      LEFT JOIN vehicles v ON r.default_vehicle_id = v.id
      LEFT JOIN drivers d ON r.default_driver_id = d.id
      WHERE r.id = ? AND r.school_id = ?
    `).get(req.params.id, schoolId);
  if (!route) {
    return res.status(404).json({ success: false, error: "ROUTE_NOT_FOUND" });
  }
  const stops = db.prepare(`
      SELECT rs.*,
        (SELECT COUNT(*) FROM transport_assignments ta WHERE (ta.morning_stop_id = rs.id OR ta.evening_stop_id = rs.id) AND ta.is_active = 1) as students_at_stop
      FROM route_stops rs
      WHERE rs.route_id = ?
      ORDER BY rs.sequence_order ASC
    `).all(route.id);
  const students = db.prepare(`
      SELECT s.id, s.admission_number, s.full_name, s.grade, s.section, s.emergency_phone,
        ta.morning_stop_id, ta.evening_stop_id,
        rs1.stop_name as morning_stop_name, rs2.stop_name as evening_stop_name
      FROM transport_assignments ta
      JOIN students s ON ta.student_id = s.id
      LEFT JOIN route_stops rs1 ON ta.morning_stop_id = rs1.id
      LEFT JOIN route_stops rs2 ON ta.evening_stop_id = rs2.id
      WHERE (ta.morning_route_id = ? OR ta.evening_route_id = ?) AND ta.is_active = 1 AND s.school_id = ?
      ORDER BY s.grade ASC, s.full_name ASC
    `).all(route.id, route.id, schoolId);
  return res.json({ success: true, route, stops, students });
});
routeRoutes.post(
  "/",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const {
      routeCode,
      name,
      description,
      morningStartTime,
      eveningStartTime,
      defaultVehicleId,
      defaultDriverId,
      stops
    } = req.body;
    if (!routeCode || !name) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Route code and route name are required"
      });
    }
    const cleanCode = routeCode.trim().toUpperCase();
    const existing = db.prepare("SELECT id FROM routes WHERE school_id = ? AND UPPER(route_code) = ?").get(schoolId, cleanCode);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "DUPLICATE_ROUTE_CODE",
        message: `Route with code "${cleanCode}" already exists.`
      });
    }
    const routeId = `rt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.exec("BEGIN TRANSACTION;");
    try {
      db.prepare(`
        INSERT INTO routes (id, school_id, route_code, name, description, morning_start_time, evening_start_time, default_vehicle_id, default_driver_id, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        routeId,
        schoolId,
        cleanCode,
        name.trim(),
        description || null,
        morningStartTime || "07:00",
        eveningStartTime || "14:30",
        defaultVehicleId || null,
        defaultDriverId || null
      );
      if (Array.isArray(stops) && stops.length > 0) {
        stops.forEach((st, idx) => {
          const stopId = `stp_${routeId}_${idx + 1}`;
          db.prepare(`
            INSERT INTO route_stops (id, route_id, stop_name, landmark, latitude, longitude, sequence_order, morning_scheduled_time, evening_scheduled_time, geofence_radius_meters)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            stopId,
            routeId,
            st.stopName || `Stop ${idx + 1}`,
            st.landmark || null,
            parseFloat(st.latitude) || 28.6139,
            parseFloat(st.longitude) || 77.209,
            idx + 1,
            st.morningScheduledTime || null,
            st.eveningScheduledTime || null,
            st.geofenceRadiusMeters || 50
          );
        });
      }
      db.exec("COMMIT;");
      logAudit({
        schoolId,
        userId: req.user?.id,
        action: "CREATE_ROUTE",
        entityType: "ROUTE",
        entityId: routeId,
        newValues: { routeCode: cleanCode, name, stopsCount: stops?.length || 0 }
      });
      return res.status(201).json({ success: true, message: "Route created successfully", routeId });
    } catch (err) {
      db.exec("ROLLBACK;");
      return formatSafeServerError(res, err, "CREATE_ROUTE");
    }
  }
);
routeRoutes.post(
  "/:id/stops",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const routeId = req.params.id;
    const route = db.prepare("SELECT id FROM routes WHERE id = ? AND school_id = ?").get(routeId, schoolId);
    if (!route) {
      return res.status(404).json({ success: false, error: "ROUTE_NOT_FOUND" });
    }
    const {
      stopName,
      landmark,
      latitude,
      longitude,
      morningScheduledTime,
      eveningScheduledTime,
      geofenceRadiusMeters
    } = req.body;
    if (!stopName || latitude === void 0 || longitude === void 0) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Stop name, latitude, and longitude are required"
      });
    }
    const maxSeq = db.prepare("SELECT MAX(sequence_order) as m FROM route_stops WHERE route_id = ?").get(routeId)?.m || 0;
    const nextSeq = maxSeq + 1;
    const stopId = `stp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    db.prepare(`
      INSERT INTO route_stops (id, route_id, stop_name, landmark, latitude, longitude, sequence_order, morning_scheduled_time, evening_scheduled_time, geofence_radius_meters)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stopId,
      routeId,
      stopName.trim(),
      landmark || null,
      parseFloat(latitude),
      parseFloat(longitude),
      nextSeq,
      morningScheduledTime || null,
      eveningScheduledTime || null,
      geofenceRadiusMeters || 50
    );
    return res.status(201).json({ success: true, message: "Stop added to route", stopId, sequenceOrder: nextSeq });
  }
);

// src/server/routes/tripRoutes.ts
import { Router as Router7 } from "express";

// src/server/notificationService.ts
import crypto6 from "node:crypto";
async function dispatchNotification(params) {
  const {
    schoolId,
    userId,
    title,
    message,
    notificationType,
    relatedTripId = null,
    relatedStudentId = null,
    channel = "IN_APP"
  } = params;
  const timeWindowBucket = Math.floor(Date.now() / (2 * 60 * 1e3));
  const effectiveIdempotencyKey = params.idempotencyKey || crypto6.createHash("sha256").update(
    `${schoolId}:${userId}:${notificationType}:${relatedTripId || "none"}:${relatedStudentId || "none"}:${timeWindowBucket}`
  ).digest("hex");
  const existing = db.prepare("SELECT * FROM notifications WHERE idempotency_key = ? LIMIT 1").get(effectiveIdempotencyKey);
  if (existing) {
    return existing;
  }
  let deliveryStatus = "DELIVERED_IN_APP";
  let deliveryProvider = "SURAKSHAVAHAN_INTERNAL";
  let providerResponse = "Internal in-app notification store";
  if (channel === "SMS") {
    const smsApiKey = process.env.SMS_GATEWAY_API_KEY;
    if (!smsApiKey || smsApiKey.trim() === "") {
      deliveryStatus = "DISABLED_NO_GATEWAY";
      deliveryProvider = "SMS_GATEWAY";
      providerResponse = "SMS_GATEWAY_API_KEY environment variable is missing. External SMS dispatch disabled.";
    } else {
      deliveryStatus = "QUEUED";
      deliveryProvider = "SMS_GATEWAY";
      providerResponse = "Queued for gateway transmission";
    }
  } else if (channel === "PUSH") {
    const fcmPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
    if (!fcmPath || fcmPath.trim() === "") {
      deliveryStatus = "DISABLED_NO_GATEWAY";
      deliveryProvider = "FCM_PUSH";
      providerResponse = "FIREBASE_SERVICE_ACCOUNT_KEY_PATH is missing. Mobile push notification dispatch disabled.";
    } else {
      deliveryStatus = "QUEUED";
      deliveryProvider = "FCM_PUSH";
      providerResponse = "Queued for FCM provider";
    }
  }
  const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  db.prepare(`
    INSERT INTO notifications (
      id, school_id, user_id, title, message, notification_type,
      related_trip_id, related_student_id, delivery_status, channel,
      delivery_provider, provider_response, idempotency_key, sent_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run(
    notifId,
    schoolId,
    userId,
    title,
    message,
    notificationType,
    relatedTripId,
    relatedStudentId,
    deliveryStatus,
    channel,
    deliveryProvider,
    providerResponse,
    effectiveIdempotencyKey
  );
  const canonical = db.prepare("SELECT * FROM notifications WHERE idempotency_key = ?").get(effectiveIdempotencyKey);
  if (canonical && canonical.id === notifId) {
    logAudit({
      schoolId,
      userId,
      action: "NOTIFICATION_DISPATCHED",
      entityType: "NOTIFICATION",
      entityId: notifId,
      newValues: {
        type: notificationType,
        channel,
        deliveryStatus,
        deliveryProvider,
        idempotencyKey: effectiveIdempotencyKey
      }
    });
  }
  return canonical;
}

// src/server/routes/tripRoutes.ts
var tripRoutes = Router7();
tripRoutes.get(
  "/driver/active",
  authenticate,
  requireSchoolContext(["DRIVER", "ATTENDANT", "TRANSPORT_MANAGER", "SCHOOL_ADMIN", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const userId = req.user.id;
    const driver = db.prepare("SELECT id, full_name, phone, license_number FROM drivers WHERE user_id = ? AND school_id = ?").get(userId, schoolId);
    let query = `
      SELECT t.*,
        r.route_code, r.name as route_name, r.description as route_description,
        v.bus_number, v.registration_number, v.capacity as vehicle_capacity,
        d.full_name as driver_name, d.phone as driver_phone
      FROM trips t
      JOIN routes r ON t.route_id = r.id
      JOIN vehicles v ON t.vehicle_id = v.id
      JOIN drivers d ON t.driver_id = d.id
      WHERE t.school_id = ?
    `;
    const params = [schoolId];
    if (driver) {
      query += ` AND t.driver_id = ?`;
      params.push(driver.id);
    }
    query += ` AND t.status IN ('IN_PROGRESS', 'SCHEDULED')
      ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, t.scheduled_start_time ASC
      LIMIT 1
    `;
    const trip = db.prepare(query).get(...params);
    if (!trip) {
      return res.json({
        success: true,
        hasActiveTrip: false,
        message: "No active or scheduled trips assigned today.",
        driver: driver || null
      });
    }
    const stops = db.prepare(`
        SELECT ts.*, rs.stop_name, rs.landmark, rs.latitude, rs.longitude, rs.morning_scheduled_time, rs.evening_scheduled_time, rs.geofence_radius_meters
        FROM trip_stops ts
        JOIN route_stops rs ON ts.route_stop_id = rs.id
        WHERE ts.trip_id = ?
        ORDER BY ts.stop_order ASC
      `).all(trip.id);
    const stopIdColumn = trip.trip_type === "EVENING_DROP" ? "ta.evening_stop_id" : "ta.morning_stop_id";
    const routeIdColumn = trip.trip_type === "EVENING_DROP" ? "ta.evening_route_id" : "ta.morning_route_id";
    const expectedStudents = db.prepare(`
        SELECT s.id, s.admission_number, s.full_name, s.grade, s.section, s.emergency_phone,
          rs.id as assigned_stop_id, rs.stop_name as assigned_stop_name, rs.sequence_order as stop_sequence,
          (SELECT ae.event_type FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'BOARDING' LIMIT 1) as boarding_status,
          (SELECT ae.scanned_at FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'BOARDING' LIMIT 1) as boarded_at,
          (SELECT ae.scan_method FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'BOARDING' LIMIT 1) as boarding_method,
          (SELECT ae.event_type FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'DROP_OFF' LIMIT 1) as dropoff_status,
          (SELECT ae.scanned_at FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'DROP_OFF' LIMIT 1) as dropped_at
        FROM transport_assignments ta
        JOIN students s ON ta.student_id = s.id
        JOIN route_stops rs ON ${stopIdColumn} = rs.id
        WHERE ${routeIdColumn} = ? AND ta.is_active = 1 AND s.school_id = ?
        ORDER BY rs.sequence_order ASC, s.full_name ASC
      `).all(trip.id, trip.id, trip.id, trip.id, trip.id, trip.route_id, schoolId);
    const latestLocation = db.prepare("SELECT * FROM bus_locations WHERE trip_id = ? ORDER BY recorded_at DESC LIMIT 1").get(trip.id);
    return res.json({
      success: true,
      hasActiveTrip: true,
      driver: driver || { id: trip.driver_id, full_name: trip.driver_name, phone: trip.driver_phone },
      trip,
      stops,
      expectedStudents,
      latestLocation
    });
  }
);
tripRoutes.get("/", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const status = req.query.status;
  const date = req.query.date || "";
  const driverId = req.query.driverId || "";
  let query = `
    SELECT t.*,
      r.route_code, r.name as route_name,
      v.bus_number, v.registration_number,
      d.full_name as driver_name, d.phone as driver_phone,
      (SELECT COUNT(*) FROM trip_stops ts WHERE ts.trip_id = t.id) as total_stops,
      (SELECT COUNT(*) FROM trip_stops ts WHERE ts.trip_id = t.id AND ts.status = 'DEPARTED') as departed_stops,
      (SELECT COUNT(DISTINCT ae.student_id) FROM attendance_events ae WHERE ae.trip_id = t.id AND ae.event_type = 'BOARDING') as boarded_count,
      (SELECT COUNT(DISTINCT ae.student_id) FROM attendance_events ae WHERE ae.trip_id = t.id AND ae.event_type = 'DROP_OFF') as dropped_count,
      (SELECT bl.recorded_at FROM bus_locations bl WHERE bl.trip_id = t.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_gps_at,
      (SELECT bl.latitude FROM bus_locations bl WHERE bl.trip_id = t.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_lat,
      (SELECT bl.longitude FROM bus_locations bl WHERE bl.trip_id = t.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_lng,
      (SELECT bl.speed_kmh FROM bus_locations bl WHERE bl.trip_id = t.id ORDER BY bl.recorded_at DESC LIMIT 1) as last_speed
    FROM trips t
    JOIN routes r ON t.route_id = r.id
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN drivers d ON t.driver_id = d.id
    WHERE t.school_id = ?
  `;
  const params = [schoolId];
  if (status) {
    query += ` AND t.status = ?`;
    params.push(status);
  }
  if (date) {
    query += ` AND t.trip_date = ?`;
    params.push(date);
  }
  if (driverId) {
    query += ` AND t.driver_id = ?`;
    params.push(driverId);
  } else if (req.schoolContext?.role === "DRIVER") {
    const driver = db.prepare("SELECT id FROM drivers WHERE user_id = ? AND school_id = ?").get(req.user.id, schoolId);
    if (driver) {
      query += ` AND t.driver_id = ?`;
      params.push(driver.id);
    }
  }
  query += ` ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'SCHEDULED' THEN 2 ELSE 3 END, t.created_at DESC`;
  const trips = db.prepare(query).all(...params);
  return res.json({ success: true, trips });
});
tripRoutes.get("/:id", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const trip = db.prepare(`
      SELECT t.*,
        r.route_code, r.name as route_name, r.description as route_description,
        v.bus_number, v.registration_number, v.capacity as vehicle_capacity,
        d.full_name as driver_name, d.phone as driver_phone,
        u1.full_name as started_by_name,
        u2.full_name as completed_by_name
      FROM trips t
      JOIN routes r ON t.route_id = r.id
      JOIN vehicles v ON t.vehicle_id = v.id
      JOIN drivers d ON t.driver_id = d.id
      LEFT JOIN users u1 ON t.started_by_user_id = u1.id
      LEFT JOIN users u2 ON t.completed_by_user_id = u2.id
      WHERE t.id = ? AND t.school_id = ?
    `).get(req.params.id, schoolId);
  if (!trip) {
    return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
  }
  const stops = db.prepare(`
      SELECT ts.*, rs.stop_name, rs.landmark, rs.latitude, rs.longitude, rs.morning_scheduled_time, rs.evening_scheduled_time, rs.geofence_radius_meters
      FROM trip_stops ts
      JOIN route_stops rs ON ts.route_stop_id = rs.id
      WHERE ts.trip_id = ?
      ORDER BY ts.stop_order ASC
    `).all(trip.id);
  const stopIdColumn = trip.trip_type === "EVENING_DROP" ? "ta.evening_stop_id" : "ta.morning_stop_id";
  const routeIdColumn = trip.trip_type === "EVENING_DROP" ? "ta.evening_route_id" : "ta.morning_route_id";
  const expectedStudents = db.prepare(`
      SELECT s.id, s.admission_number, s.full_name, s.grade, s.section, s.emergency_phone,
        rs.id as assigned_stop_id, rs.stop_name as assigned_stop_name, rs.sequence_order as stop_sequence,
        (SELECT ae.event_type FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'BOARDING' LIMIT 1) as boarding_status,
        (SELECT ae.scanned_at FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'BOARDING' LIMIT 1) as boarded_at,
        (SELECT ae.scan_method FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'BOARDING' LIMIT 1) as boarding_method,
        (SELECT ae.event_type FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'DROP_OFF' LIMIT 1) as dropoff_status,
        (SELECT ae.scanned_at FROM attendance_events ae WHERE ae.trip_id = ? AND ae.student_id = s.id AND ae.event_type = 'DROP_OFF' LIMIT 1) as dropped_at
      FROM transport_assignments ta
      JOIN students s ON ta.student_id = s.id
      JOIN route_stops rs ON ${stopIdColumn} = rs.id
      WHERE ${routeIdColumn} = ? AND ta.is_active = 1 AND s.school_id = ?
      ORDER BY rs.sequence_order ASC, s.full_name ASC
    `).all(trip.id, trip.id, trip.id, trip.id, trip.id, trip.route_id, schoolId);
  const latestLocation = db.prepare("SELECT * FROM bus_locations WHERE trip_id = ? ORDER BY recorded_at DESC LIMIT 1").get(trip.id);
  return res.json({
    success: true,
    trip,
    stops,
    expectedStudents,
    latestLocation
  });
});
tripRoutes.post(
  "/",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const {
      routeId,
      vehicleId,
      driverId,
      tripType,
      // MORNING_PICKUP, EVENING_DROP, SPECIAL
      tripDate,
      // YYYY-MM-DD
      scheduledStartTime,
      // HH:MM
      notes
    } = req.body;
    if (!routeId || !vehicleId || !driverId || !tripType || !tripDate) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Route, vehicle, driver, trip type, and trip date are required"
      });
    }
    const route = db.prepare("SELECT id FROM routes WHERE id = ? AND school_id = ?").get(routeId, schoolId);
    const vehicle = db.prepare("SELECT id FROM vehicles WHERE id = ? AND school_id = ?").get(vehicleId, schoolId);
    const driver = db.prepare("SELECT id FROM drivers WHERE id = ? AND school_id = ?").get(driverId, schoolId);
    if (!route || !vehicle || !driver) {
      return res.status(400).json({
        success: false,
        error: "INVALID_RESOURCE",
        message: "Route, vehicle, or driver not found or does not belong to this school."
      });
    }
    const tripId = `trip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.exec("BEGIN TRANSACTION;");
    try {
      db.prepare(`
        INSERT INTO trips (
          id, school_id, route_id, vehicle_id, driver_id, trip_type, trip_date,
          scheduled_start_time, status, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?)
      `).run(
        tripId,
        schoolId,
        routeId,
        vehicleId,
        driverId,
        tripType,
        tripDate,
        scheduledStartTime || "07:00",
        notes || null
      );
      const routeStops = db.prepare("SELECT id, sequence_order FROM route_stops WHERE route_id = ? ORDER BY sequence_order ASC").all(routeId);
      routeStops.forEach((rs) => {
        db.prepare(`
          INSERT INTO trip_stops (id, trip_id, route_stop_id, stop_order, status)
          VALUES (?, ?, ?, ?, 'PENDING')
        `).run(`ts_${tripId}_${rs.sequence_order}`, tripId, rs.id, rs.sequence_order);
      });
      db.exec("COMMIT;");
      logAudit({
        schoolId,
        userId: req.user?.id,
        action: "SCHEDULE_TRIP",
        entityType: "TRIP",
        entityId: tripId,
        newValues: { routeId, vehicleId, driverId, tripType, tripDate }
      });
      return res.status(201).json({ success: true, message: "Trip scheduled successfully", tripId });
    } catch (err) {
      db.exec("ROLLBACK;");
      return formatSafeServerError(res, err, "SCHEDULE_TRIP");
    }
  }
);
tripRoutes.post(
  "/:id/start",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "DRIVER", "PLATFORM_ADMIN"]),
  async (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const tripId = req.params.id;
    const trip = db.prepare("SELECT * FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
    if (!trip) {
      return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
    }
    if (trip.status !== "SCHEDULED") {
      return res.status(400).json({
        success: false,
        error: "INVALID_TRANSITION",
        message: `Cannot start trip with status "${trip.status}". Allowed transition only from SCHEDULED.`
      });
    }
    const conflictingVehicle = db.prepare("SELECT id FROM trips WHERE vehicle_id = ? AND status = 'IN_PROGRESS' AND id != ?").get(trip.vehicle_id, tripId);
    if (conflictingVehicle) {
      return res.status(409).json({
        success: false,
        error: "VEHICLE_BUSY",
        message: `This vehicle is currently running in active trip #${conflictingVehicle.id}. Please complete that trip first.`
      });
    }
    const conflictingDriver = db.prepare("SELECT id FROM trips WHERE driver_id = ? AND status = 'IN_PROGRESS' AND id != ?").get(trip.driver_id, tripId);
    if (conflictingDriver) {
      return res.status(409).json({
        success: false,
        error: "DRIVER_BUSY",
        message: `This driver is currently operating active trip #${conflictingDriver.id}.`
      });
    }
    db.prepare(`
      UPDATE trips SET
        status = 'IN_PROGRESS',
        actual_start_time = datetime('now'),
        started_by_user_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id, tripId);
    const stopColumn = trip.trip_type === "EVENING_DROP" ? "evening_route_id" : "morning_route_id";
    const parents = db.prepare(`
        SELECT DISTINCT g.user_id, s.full_name as student_name
        FROM transport_assignments ta
        JOIN students s ON ta.student_id = s.id
        JOIN student_guardians sg ON s.id = sg.student_id
        JOIN guardians g ON sg.guardian_id = g.id
        WHERE ta.${stopColumn} = ? AND ta.is_active = 1 AND g.user_id IS NOT NULL
      `).all(trip.route_id);
    for (const p of parents) {
      await dispatchNotification({
        schoolId,
        userId: p.user_id,
        title: "School Bus Trip Started",
        message: `The school bus for ${p.student_name} has started its journey.`,
        notificationType: "TRIP_STARTED",
        relatedTripId: tripId,
        channel: "IN_APP"
      });
    }
    broadcastTripStatusChange(tripId, "IN_PROGRESS", { actualStartTime: (/* @__PURE__ */ new Date()).toISOString() });
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: "START_TRIP",
      entityType: "TRIP",
      entityId: tripId
    });
    return res.json({ success: true, message: "Trip started successfully. Live tracking is active." });
  }
);
tripRoutes.post(
  "/:id/complete",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "DRIVER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const tripId = req.params.id;
    const { physicalCheckConfirmed, reconciliationNotes } = req.body;
    const trip = db.prepare("SELECT * FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
    if (!trip) {
      return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
    }
    if (trip.status !== "IN_PROGRESS") {
      return res.status(400).json({
        success: false,
        error: "INVALID_TRANSITION",
        message: `Cannot complete trip with status "${trip.status}". Trip must be IN_PROGRESS.`
      });
    }
    if (!physicalCheckConfirmed) {
      return res.status(400).json({
        success: false,
        error: "PHYSICAL_CHECK_REQUIRED",
        message: "Driver or attendant must confirm that the physical safety check inside the bus has been completed."
      });
    }
    const missingDropoffs = db.prepare(`
        SELECT s.id, s.full_name, s.admission_number, s.grade, s.section, s.emergency_phone
        FROM attendance_events ae
        JOIN students s ON ae.student_id = s.id
        WHERE ae.trip_id = ? AND ae.event_type = 'BOARDING'
        AND NOT EXISTS (
          SELECT 1 FROM attendance_events ae2
          WHERE ae2.trip_id = ae.trip_id AND ae2.student_id = ae.student_id AND ae2.event_type = 'DROP_OFF'
        )
      `).all(tripId);
    const tenantSettings = db.prepare("SELECT strict_reconciliation_required FROM tenant_settings WHERE school_id = ?").get(schoolId);
    if (tenantSettings?.strict_reconciliation_required && missingDropoffs.length > 0 && !reconciliationNotes) {
      return res.status(422).json({
        success: false,
        error: "RECONCILIATION_EXCEPTION",
        message: `${missingDropoffs.length} student(s) boarded this bus but do not have a recorded drop-off. Please review the reconciliation roster or provide mandatory resolution notes.`,
        unaccountedStudents: missingDropoffs
      });
    }
    db.prepare(`
      UPDATE trips SET
        status = 'COMPLETED',
        actual_end_time = datetime('now'),
        completed_by_user_id = ?,
        notes = COALESCE(?, notes),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id, reconciliationNotes || null, tripId);
    broadcastTripStatusChange(tripId, "COMPLETED", {
      actualEndTime: (/* @__PURE__ */ new Date()).toISOString(),
      missingDropoffsCount: missingDropoffs.length
    });
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: "COMPLETE_TRIP",
      entityType: "TRIP",
      entityId: tripId,
      newValues: {
        physicalCheckConfirmed: true,
        reconciliationNotes,
        missingDropoffsCount: missingDropoffs.length
      }
    });
    return res.json({
      success: true,
      message: "Trip completed successfully. Physical safety inspection and reconciliation verified.",
      unaccountedStudentsCount: missingDropoffs.length
    });
  }
);
tripRoutes.post(
  "/:id/cancel",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const tripId = req.params.id;
    const { reason } = req.body;
    const trip = db.prepare("SELECT * FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
    if (!trip) {
      return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
    }
    if (trip.status === "COMPLETED") {
      return res.status(400).json({
        success: false,
        error: "CANNOT_CANCEL_COMPLETED",
        message: "Completed trips cannot be cancelled."
      });
    }
    db.prepare(`
      UPDATE trips SET
        status = 'CANCELLED',
        cancellation_reason = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(reason || "Cancelled by administration", tripId);
    broadcastTripStatusChange(tripId, "CANCELLED", { reason });
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: "CANCEL_TRIP",
      entityType: "TRIP",
      entityId: tripId,
      newValues: { reason }
    });
    return res.json({ success: true, message: "Trip marked as cancelled." });
  }
);
tripRoutes.post(
  "/:id/stops/:stopId/status",
  authenticate,
  requireSchoolContext(["DRIVER", "ATTENDANT", "TRANSPORT_MANAGER", "SCHOOL_ADMIN", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const { id: tripId, stopId } = req.params;
    const { status, notes } = req.body;
    if (!["ARRIVED", "DEPARTED", "SKIPPED", "PENDING"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "INVALID_STATUS",
        message: "Status must be ARRIVED, DEPARTED, SKIPPED, or PENDING."
      });
    }
    const trip = db.prepare("SELECT id, status FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
    if (!trip) {
      return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
    }
    const tripStop = db.prepare("SELECT * FROM trip_stops WHERE trip_id = ? AND (id = ? OR route_stop_id = ?)").get(tripId, stopId, stopId);
    if (!tripStop) {
      return res.status(404).json({ success: false, error: "STOP_NOT_FOUND", message: "Stop not associated with this trip." });
    }
    const arrivedAt = status === "ARRIVED" ? (/* @__PURE__ */ new Date()).toISOString() : tripStop.arrived_at;
    const departedAt = status === "DEPARTED" ? (/* @__PURE__ */ new Date()).toISOString() : tripStop.departed_at;
    db.prepare(`
      UPDATE trip_stops SET
        status = ?,
        arrived_at = COALESCE(?, arrived_at),
        departed_at = COALESCE(?, departed_at),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(status, arrivedAt, departedAt, notes || null, tripStop.id);
    broadcastTripStatusChange(tripId, trip.status, {
      stopEvent: {
        stopId: tripStop.id,
        routeStopId: tripStop.route_stop_id,
        status,
        arrivedAt,
        departedAt
      }
    });
    return res.json({
      success: true,
      message: `Stop status updated to ${status}.`,
      stop: {
        id: tripStop.id,
        routeStopId: tripStop.route_stop_id,
        status,
        arrivedAt,
        departedAt
      }
    });
  }
);
tripRoutes.post(
  "/:id/alert",
  authenticate,
  requireSchoolContext(["DRIVER", "ATTENDANT", "TRANSPORT_MANAGER", "SCHOOL_ADMIN", "PLATFORM_ADMIN"]),
  async (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const tripId = req.params.id;
    const { alertType, message, delayMinutes } = req.body;
    if (!alertType || !message) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "alertType and message are required."
      });
    }
    const trip = db.prepare(`
        SELECT t.*, r.name as route_name, v.bus_number
        FROM trips t
        JOIN routes r ON t.route_id = r.id
        JOIN vehicles v ON t.vehicle_id = v.id
        WHERE t.id = ? AND t.school_id = ?
      `).get(tripId, schoolId);
    if (!trip) {
      return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
    }
    const title = alertType === "DELAY" ? `Bus Delay Notice: Bus ${trip.bus_number} (${delayMinutes || 15} mins)` : `Transit Notice: Bus ${trip.bus_number} (${alertType})`;
    const stopCol = trip.trip_type === "EVENING_DROP" ? "evening_route_id" : "morning_route_id";
    const parents = db.prepare(`
        SELECT DISTINCT g.user_id, s.full_name as student_name
        FROM transport_assignments ta
        JOIN students s ON ta.student_id = s.id
        JOIN student_guardians sg ON s.id = sg.student_id
        JOIN guardians g ON sg.guardian_id = g.id
        WHERE ta.${stopCol} = ? AND ta.is_active = 1 AND g.user_id IS NOT NULL
      `).all(trip.route_id);
    for (const p of parents) {
      await dispatchNotification({
        schoolId,
        userId: p.user_id,
        title,
        message: `${message} (Affected student: ${p.student_name})`,
        notificationType: alertType,
        relatedTripId: tripId,
        channel: "IN_APP"
      });
    }
    broadcastTripStatusChange(tripId, trip.status, {
      alert: { alertType, message, delayMinutes, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: `TRIP_ALERT_${alertType}`,
      entityType: "TRIP",
      entityId: tripId,
      newValues: { alertType, message, delayMinutes }
    });
    return res.json({
      success: true,
      message: `Alert dispatched to ${parents.length} registered guardians.`,
      recipientsCount: parents.length
    });
  }
);

// src/server/routes/locationRoutes.ts
import { Router as Router8 } from "express";
var locationRoutes = Router8();
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
locationRoutes.post(
  "/:tripId/locations",
  authenticate,
  requireSchoolContext(["DRIVER", "TRANSPORT_MANAGER", "SCHOOL_ADMIN", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const { tripId } = req.params;
    const {
      latitude,
      longitude,
      speedKmh,
      heading,
      accuracyMeters,
      altitude,
      recordedAt
    } = req.body;
    if (latitude === void 0 || longitude === void 0) {
      return res.status(400).json({
        success: false,
        error: "INVALID_COORDINATES",
        message: "Latitude and longitude are mandatory."
      });
    }
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        error: "COORDINATES_OUT_OF_BOUNDS",
        message: "Latitude must be between -90 and 90; longitude must be between -180 and 180."
      });
    }
    const trip = db.prepare("SELECT id, school_id, vehicle_id, driver_id, status FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
    if (!trip) {
      return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
    }
    if (trip.status !== "IN_PROGRESS") {
      return res.status(400).json({
        success: false,
        error: "TRIP_NOT_ACTIVE",
        message: `Cannot ingest GPS points for trip in "${trip.status}" state. Only IN_PROGRESS trips accept telemetry.`
      });
    }
    const recordedTimestamp = recordedAt || (/* @__PURE__ */ new Date()).toISOString();
    const locId = `loc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const speed = speedKmh !== void 0 ? Math.max(0, parseFloat(speedKmh)) : 0;
    const hdg = heading !== void 0 ? parseFloat(heading) : 0;
    const acc = accuracyMeters !== void 0 ? parseFloat(accuracyMeters) : 5;
    db.prepare(`
      INSERT INTO bus_locations (
        id, trip_id, vehicle_id, latitude, longitude, speed_kmh, heading,
        accuracy_meters, altitude, recorded_at, ingested_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      locId,
      tripId,
      trip.vehicle_id,
      lat,
      lng,
      speed,
      hdg,
      acc,
      altitude ? parseFloat(altitude) : null,
      recordedTimestamp
    );
    const pendingStops = db.prepare(`
        SELECT ts.id, ts.route_stop_id, ts.status, rs.stop_name, rs.latitude, rs.longitude, rs.geofence_radius_meters
        FROM trip_stops ts
        JOIN route_stops rs ON ts.route_stop_id = rs.id
        WHERE ts.trip_id = ? AND ts.status = 'PENDING'
        ORDER BY ts.stop_order ASC
        LIMIT 1
      `).all(tripId);
    if (pendingStops.length > 0) {
      const nextStop = pendingStops[0];
      const distance = calculateDistanceMeters(lat, lng, nextStop.latitude, nextStop.longitude);
      const threshold = nextStop.geofence_radius_meters || 50;
      if (distance <= threshold) {
        db.prepare(`
          UPDATE trip_stops SET
            status = 'ARRIVED',
            arrived_at = datetime('now')
          WHERE id = ?
        `).run(nextStop.id);
      }
    }
    const liveTelemetry = {
      id: locId,
      tripId,
      vehicleId: trip.vehicle_id,
      latitude: lat,
      longitude: lng,
      speedKmh: speed,
      heading: hdg,
      accuracyMeters: acc,
      recordedAt: recordedTimestamp
    };
    broadcastTripLocation(tripId, liveTelemetry);
    return res.status(201).json({
      success: true,
      message: "Location ingested and broadcast successfully",
      location: liveTelemetry
    });
  }
);
locationRoutes.post(
  "/:tripId/locations/batch",
  authenticate,
  requireSchoolContext(["DRIVER", "TRANSPORT_MANAGER", "SCHOOL_ADMIN", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const { tripId } = req.params;
    const { points } = req.body;
    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({
        success: false,
        error: "INVALID_PAYLOAD",
        message: "points must be a non-empty array of coordinates."
      });
    }
    const trip = db.prepare("SELECT id, school_id, vehicle_id, status FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
    if (!trip) {
      return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
    }
    if (trip.status !== "IN_PROGRESS") {
      return res.status(400).json({
        success: false,
        error: "TRIP_NOT_ACTIVE",
        message: "Cannot ingest GPS points for non-active trips."
      });
    }
    db.exec("BEGIN TRANSACTION;");
    try {
      const stmt = db.prepare(`
        INSERT INTO bus_locations (
          id, trip_id, vehicle_id, latitude, longitude, speed_kmh, heading,
          accuracy_meters, altitude, recorded_at, ingested_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      let lastTelemetry = null;
      let validCount = 0;
      for (const p of points) {
        const lat = parseFloat(p.latitude);
        const lng = parseFloat(p.longitude);
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          continue;
        }
        const locId = `loc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const recordedTimestamp = p.recordedAt || (/* @__PURE__ */ new Date()).toISOString();
        const speed = p.speedKmh !== void 0 ? Math.max(0, parseFloat(p.speedKmh)) : 0;
        const hdg = p.heading !== void 0 ? parseFloat(p.heading) : 0;
        const acc = p.accuracyMeters !== void 0 ? parseFloat(p.accuracyMeters) : 5;
        stmt.run(
          locId,
          tripId,
          trip.vehicle_id,
          lat,
          lng,
          speed,
          hdg,
          acc,
          p.altitude ? parseFloat(p.altitude) : null,
          recordedTimestamp
        );
        lastTelemetry = {
          id: locId,
          tripId,
          vehicleId: trip.vehicle_id,
          latitude: lat,
          longitude: lng,
          speedKmh: speed,
          heading: hdg,
          accuracyMeters: acc,
          recordedAt: recordedTimestamp
        };
        validCount++;
      }
      db.exec("COMMIT;");
      if (lastTelemetry) {
        broadcastTripLocation(tripId, lastTelemetry);
      }
      return res.status(201).json({
        success: true,
        message: `Successfully ingested ${validCount} GPS points.`,
        ingestedCount: validCount,
        latestLocation: lastTelemetry
      });
    } catch (err) {
      db.exec("ROLLBACK;");
      return formatSafeServerError(res, err, "BATCH_GPS_INGEST");
    }
  }
);
locationRoutes.get("/:tripId/locations/latest", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const { tripId } = req.params;
  const trip = db.prepare("SELECT id, status, vehicle_id FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
  if (!trip) {
    return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
  }
  const latest = db.prepare("SELECT * FROM bus_locations WHERE trip_id = ? ORDER BY recorded_at DESC LIMIT 1").get(tripId);
  if (!latest) {
    return res.json({
      success: true,
      hasLocation: false,
      message: "No GPS telemetry received for this trip yet.",
      tripStatus: trip.status
    });
  }
  const recordedMillis = new Date(latest.recorded_at).getTime();
  const secondsAgo = Math.floor((Date.now() - recordedMillis) / 1e3);
  const isStale = secondsAgo > 120;
  return res.json({
    success: true,
    hasLocation: true,
    location: latest,
    freshness: {
      secondsAgo,
      isStale,
      lastUpdated: latest.recorded_at
    },
    tripStatus: trip.status
  });
});
locationRoutes.get("/:tripId/locations/history", authenticate, requireSchoolContext(), (req, res) => {
  const schoolId = req.schoolContext.schoolId;
  const { tripId } = req.params;
  const trip = db.prepare("SELECT id FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
  if (!trip) {
    return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
  }
  const trail = db.prepare(`
      SELECT latitude, longitude, speed_kmh, heading, accuracy_meters, recorded_at
      FROM bus_locations
      WHERE trip_id = ?
      ORDER BY recorded_at ASC
      LIMIT 1000
    `).all(tripId);
  return res.json({ success: true, count: trail.length, coordinates: trail });
});

// src/server/routes/attendanceRoutes.ts
import { Router as Router9 } from "express";
import crypto7 from "crypto";
var attendanceRoutes = Router9();
async function notifyParentsOfAttendance(schoolId, studentId, tripId, eventType, stopName) {
  try {
    const student = db.prepare("SELECT full_name FROM students WHERE id = ?").get(studentId);
    const parents = db.prepare(`
        SELECT DISTINCT g.user_id
        FROM student_guardians sg
        JOIN guardians g ON sg.guardian_id = g.id
        WHERE sg.student_id = ? AND g.user_id IS NOT NULL
      `).all(studentId);
    const studentName = student ? student.full_name : "Your child";
    const title = eventType === "BOARDING" ? "Bus Boarding Confirmed" : "Bus Drop-Off Confirmed";
    const message = eventType === "BOARDING" ? `${studentName} has safely boarded the school bus at ${stopName}.` : `${studentName} has been safely dropped off at ${stopName}.`;
    for (const p of parents) {
      await dispatchNotification({
        schoolId,
        userId: p.user_id,
        title,
        message,
        notificationType: eventType,
        relatedTripId: tripId,
        relatedStudentId: studentId,
        channel: "IN_APP"
      });
    }
  } catch (err) {
    console.error("[Notify Parents Error]", err);
  }
}
attendanceRoutes.post(
  "/:tripId/attendance/scan",
  authenticate,
  requireSchoolContext(["DRIVER", "ATTENDANT", "TRANSPORT_MANAGER", "SCHOOL_ADMIN", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const { tripId } = req.params;
    const { qrPayload, stopId, latitude, longitude, preferredEventType } = req.body;
    if (!qrPayload) {
      return res.status(400).json({
        success: false,
        error: "MISSING_QR_PAYLOAD",
        message: "QR code payload string is required."
      });
    }
    const trip = db.prepare("SELECT * FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
    if (!trip) {
      return res.status(404).json({ success: false, error: "TRIP_NOT_FOUND" });
    }
    if (trip.status !== "IN_PROGRESS") {
      return res.status(400).json({
        success: false,
        error: "TRIP_NOT_ACTIVE",
        message: `Attendance can only be scanned during an IN_PROGRESS trip. (Current status: ${trip.status})`
      });
    }
    let tokenHash = "";
    let qrId = "";
    if (qrPayload.startsWith("SURAKSHA_VAHAN:")) {
      const parts = qrPayload.split(":");
      qrId = parts[1];
      tokenHash = parts[2];
    } else {
      tokenHash = crypto7.createHash("sha256").update(qrPayload.trim()).digest("hex");
    }
    let credential = db.prepare(`
        SELECT qc.*, s.full_name as student_name, s.admission_number, s.grade, s.section, s.emergency_phone
        FROM qr_credentials qc
        JOIN students s ON qc.student_id = s.id
        WHERE (qc.token_hash = ? OR qc.id = ?) AND qc.school_id = ?
      `).get(tokenHash, qrId, schoolId);
    if (!credential) {
      logAudit({
        schoolId,
        userId: req.user?.id,
        action: "QR_SCAN_REJECTED",
        entityType: "ATTENDANCE",
        newValues: { reason: "UNRECOGNIZED_QR_TOKEN", rawInput: qrPayload.substring(0, 20) }
      });
      return res.status(404).json({
        success: false,
        error: "INVALID_QR_BADGE",
        message: "Unrecognized or unassigned QR badge. Student not found."
      });
    }
    if (credential.is_revoked) {
      return res.status(403).json({
        success: false,
        error: "REVOKED_QR_BADGE",
        message: `This student QR badge was revoked (${credential.revoked_reason || "Lost card"}). Scan rejected.`
      });
    }
    const studentId = credential.student_id;
    const routeCol = trip.trip_type === "EVENING_DROP" ? "evening_route_id" : "morning_route_id";
    const assignment = db.prepare(`SELECT * FROM transport_assignments WHERE student_id = ? AND ${routeCol} = ? AND is_active = 1`).get(studentId, trip.route_id);
    if (!assignment) {
      logAudit({
        schoolId,
        userId: req.user?.id,
        action: "WRONG_BUS_SCAN_ALERT",
        entityType: "ATTENDANCE",
        entityId: studentId,
        newValues: { tripId, studentId, studentName: credential.student_name }
      });
      return res.status(400).json({
        success: false,
        error: "WRONG_BUS_ASSIGNMENT",
        message: `Safety Alert: ${credential.student_name} (${credential.admission_number}) is not assigned to this bus route (${trip.route_id}).`
      });
    }
    const existingEvents = db.prepare(`
        SELECT event_type, scanned_at, id FROM attendance_events
        WHERE trip_id = ? AND student_id = ?
        ORDER BY scanned_at DESC
      `).all(tripId, studentId);
    const hasBoarded = existingEvents.some((e) => e.event_type === "BOARDING");
    const hasDropped = existingEvents.some((e) => e.event_type === "DROP_OFF");
    let nextEventType = preferredEventType || (hasBoarded ? "DROP_OFF" : "BOARDING");
    if (nextEventType === "BOARDING" && hasBoarded) {
      return res.status(409).json({
        success: false,
        error: "DUPLICATE_BOARDING",
        message: `${credential.student_name} was already boarded on this trip at ${existingEvents[0].scanned_at}.`
      });
    }
    if (nextEventType === "DROP_OFF" && !hasBoarded) {
      return res.status(409).json({
        success: false,
        error: "DROP_OFF_WITHOUT_BOARDING",
        message: `Out-of-order scan: Cannot record drop-off for ${credential.student_name} because boarding was not previously recorded on this trip.`
      });
    }
    if (nextEventType === "DROP_OFF" && hasDropped) {
      return res.status(409).json({
        success: false,
        error: "DUPLICATE_DROP_OFF",
        message: `${credential.student_name} was already dropped off from this trip.`
      });
    }
    const eventId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const effectiveStopId = stopId || (nextEventType === "BOARDING" ? assignment.morning_stop_id : assignment.evening_stop_id);
    const stopRecord = effectiveStopId ? db.prepare("SELECT stop_name FROM route_stops WHERE id = ?").get(effectiveStopId) : null;
    const stopName = stopRecord ? stopRecord.stop_name : "Designated Stop";
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
      req.user.id,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null
    );
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
      scanMethod: "QR",
      stopName,
      scannedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    broadcastAttendanceEvent(tripId, eventPayload);
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: `ATTENDANCE_${nextEventType}`,
      entityType: "ATTENDANCE",
      entityId: eventId,
      newValues: eventPayload
    });
    return res.status(201).json({
      success: true,
      message: `${nextEventType === "BOARDING" ? "Boarding" : "Drop-off"} confirmed for ${credential.student_name}`,
      event: eventPayload
    });
  }
);
attendanceRoutes.post(
  "/:tripId/attendance/manual",
  authenticate,
  requireSchoolContext(["DRIVER", "ATTENDANT", "TRANSPORT_MANAGER", "SCHOOL_ADMIN", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const { tripId } = req.params;
    const { studentId, eventType, stopId, manualReason, latitude, longitude } = req.body;
    if (!studentId || !eventType || !manualReason) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Student ID, event type (BOARDING or DROP_OFF), and mandatory manual reason are required."
      });
    }
    const trip = db.prepare("SELECT * FROM trips WHERE id = ? AND school_id = ?").get(tripId, schoolId);
    if (!trip || trip.status !== "IN_PROGRESS") {
      return res.status(400).json({ success: false, error: "TRIP_NOT_ACTIVE" });
    }
    const student = db.prepare("SELECT * FROM students WHERE id = ? AND school_id = ?").get(studentId, schoolId);
    if (!student) {
      return res.status(404).json({ success: false, error: "STUDENT_NOT_FOUND" });
    }
    const eventId = `att_man_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const stopRecord = stopId ? db.prepare("SELECT stop_name FROM route_stops WHERE id = ?").get(stopId) : null;
    const stopName = stopRecord ? stopRecord.stop_name : "Manual Checkpoint";
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
      req.user.id,
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
      scanMethod: "MANUAL",
      manualReason,
      stopName,
      scannedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    broadcastAttendanceEvent(tripId, eventPayload);
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: `MANUAL_ATTENDANCE_${eventType}`,
      entityType: "ATTENDANCE",
      newValues: eventPayload
    });
    return res.status(201).json({
      success: true,
      message: `Manual ${eventType} logged for ${student.full_name}. Reason audited.`,
      event: eventPayload
    });
  }
);

// src/server/routes/parentRoutes.ts
import { Router as Router10 } from "express";
var parentRoutes = Router10();
parentRoutes.get("/children", authenticate, (req, res) => {
  const userId = req.user.id;
  const guardian = db.prepare("SELECT id, full_name, phone FROM guardians WHERE user_id = ?").get(userId);
  if (!guardian) {
    return res.json({ success: true, children: [], message: "No guardian profile linked to this user." });
  }
  const children = db.prepare(`
      SELECT s.id, s.admission_number, s.full_name, s.grade, s.section, s.emergency_phone,
        s.school_id, sch.name as school_name, sch.contact_phone as school_phone,
        sg.relationship_type, sg.is_primary,
        ta.morning_route_id, ta.morning_stop_id,
        r1.route_code as morning_route_code, r1.name as morning_route_name,
        rs1.stop_name as morning_stop_name, rs1.morning_scheduled_time, rs1.latitude as morning_stop_lat, rs1.longitude as morning_stop_lng,
        ta.evening_route_id, ta.evening_stop_id,
        r2.route_code as evening_route_code, r2.name as evening_route_name,
        rs2.stop_name as evening_stop_name, rs2.evening_scheduled_time, rs2.latitude as evening_stop_lat, rs2.longitude as evening_stop_lng
      FROM student_guardians sg
      JOIN students s ON sg.student_id = s.id
      JOIN schools sch ON s.school_id = sch.id
      LEFT JOIN transport_assignments ta ON s.id = ta.student_id AND ta.is_active = 1
      LEFT JOIN routes r1 ON ta.morning_route_id = r1.id
      LEFT JOIN route_stops rs1 ON ta.morning_stop_id = rs1.id
      LEFT JOIN routes r2 ON ta.evening_route_id = r2.id
      LEFT JOIN route_stops rs2 ON ta.evening_stop_id = rs2.id
      WHERE sg.guardian_id = ?
    `).all(guardian.id);
  const enrichedChildren = children.map((child) => {
    const activeTrip = db.prepare(`
        SELECT t.id as trip_id, t.trip_type, t.status, t.scheduled_start_time, t.actual_start_time,
          v.bus_number, v.registration_number,
          d.full_name as driver_name, d.phone as driver_phone
        FROM trips t
        JOIN vehicles v ON t.vehicle_id = v.id
        JOIN drivers d ON t.driver_id = d.id
        WHERE (t.route_id = ? OR t.route_id = ?) AND t.status = 'IN_PROGRESS'
        ORDER BY t.created_at DESC
        LIMIT 1
      `).get(child.morning_route_id, child.evening_route_id);
    let latestLocation = null;
    let attendanceToday = null;
    if (activeTrip) {
      latestLocation = db.prepare("SELECT latitude, longitude, speed_kmh, heading, accuracy_meters, recorded_at FROM bus_locations WHERE trip_id = ? ORDER BY recorded_at DESC LIMIT 1").get(activeTrip.trip_id);
      attendanceToday = db.prepare(`
          SELECT event_type, scanned_at, scan_method, rs.stop_name
          FROM attendance_events ae
          LEFT JOIN route_stops rs ON ae.stop_id = rs.id
          WHERE ae.trip_id = ? AND ae.student_id = ?
          ORDER BY ae.scanned_at DESC
        `).all(activeTrip.trip_id, child.id);
    } else {
      attendanceToday = db.prepare(`
          SELECT ae.event_type, ae.scanned_at, ae.scan_method, rs.stop_name
          FROM attendance_events ae
          LEFT JOIN route_stops rs ON ae.stop_id = rs.id
          WHERE ae.student_id = ? AND date(ae.scanned_at) = date('now')
          ORDER BY ae.scanned_at DESC
        `).all(child.id);
    }
    let freshness = null;
    if (latestLocation) {
      const recordedMillis = new Date(latestLocation.recorded_at).getTime();
      const secondsAgo = Math.floor((Date.now() - recordedMillis) / 1e3);
      freshness = {
        secondsAgo,
        isStale: secondsAgo > 120,
        lastUpdated: latestLocation.recorded_at
      };
    }
    return {
      ...child,
      activeTrip: activeTrip || null,
      latestLocation,
      freshness,
      attendanceToday: attendanceToday || []
    };
  });
  return res.json({ success: true, children: enrichedChildren });
});
parentRoutes.get("/notifications", authenticate, (req, res) => {
  const userId = req.user.id;
  const notifications = db.prepare(`
      SELECT n.*, s.full_name as student_name
      FROM notifications n
      LEFT JOIN students s ON n.related_student_id = s.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `).all(userId);
  return res.json({ success: true, notifications });
});
parentRoutes.post("/notifications/mark-read", authenticate, (req, res) => {
  const { notificationId } = req.body;
  if (notificationId) {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?").run(
      notificationId,
      req.user.id
    );
  } else {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(
      req.user.id
    );
  }
  return res.json({ success: true });
});
parentRoutes.post("/device-token", authenticate, (req, res) => {
  const userId = req.user.id;
  const { token, platform } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: "VALIDATION_ERROR", message: "Device push token is required." });
  }
  const effectivePlatform = ["ANDROID", "IOS", "WEB"].includes(platform?.toUpperCase()) ? platform.toUpperCase() : "ANDROID";
  const tokenId = `tok_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  db.prepare(`
    INSERT INTO device_tokens (id, user_id, token, platform, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, token) DO UPDATE SET platform = excluded.platform, updated_at = datetime('now')
  `).run(tokenId, userId, token.trim(), effectivePlatform);
  return res.json({ success: true, message: "Device token registered successfully." });
});
parentRoutes.get("/children/:studentId/attendance", authenticate, (req, res) => {
  const userId = req.user.id;
  const { studentId } = req.params;
  const linked = db.prepare(`
      SELECT 1 FROM student_guardians sg
      JOIN guardians g ON sg.guardian_id = g.id
      WHERE sg.student_id = ? AND g.user_id = ?
    `).get(studentId, userId);
  if (!linked && req.user.systemRole !== "PLATFORM_ADMIN") {
    return res.status(403).json({
      success: false,
      error: "FORBIDDEN",
      message: "Access denied: You are only permitted to view attendance records for your own children."
    });
  }
  const events = db.prepare(`
      SELECT ae.id, ae.trip_id, ae.event_type, ae.scan_method, ae.scanned_at, ae.verification_status,
        rs.stop_name, t.trip_type, t.trip_date, v.bus_number, v.registration_number
      FROM attendance_events ae
      LEFT JOIN route_stops rs ON ae.stop_id = rs.id
      JOIN trips t ON ae.trip_id = t.id
      JOIN vehicles v ON t.vehicle_id = v.id
      WHERE ae.student_id = ?
      ORDER BY ae.scanned_at DESC
      LIMIT 100
    `).all(studentId);
  return res.json({ success: true, studentId, count: events.length, attendance: events });
});

// src/server/routes/reportRoutes.ts
import { Router as Router11 } from "express";
var reportRoutes = Router11();
reportRoutes.get(
  "/attendance-csv",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const fromDate = req.query.fromDate || "";
    const toDate = req.query.toDate || "";
    let query = `
      SELECT ae.id, ae.scanned_at, ae.event_type, ae.scan_method, ae.verification_status, ae.manual_reason,
        s.admission_number, s.full_name as student_name, s.grade, s.section, s.emergency_phone,
        t.id as trip_id, t.trip_type, t.trip_date,
        r.route_code, r.name as route_name,
        rs.stop_name,
        v.bus_number,
        u.full_name as scanned_by_name
      FROM attendance_events ae
      JOIN students s ON ae.student_id = s.id
      JOIN trips t ON ae.trip_id = t.id
      JOIN routes r ON t.route_id = r.id
      JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN route_stops rs ON ae.stop_id = rs.id
      LEFT JOIN users u ON ae.scanned_by_user_id = u.id
      WHERE ae.school_id = ?
    `;
    const params = [schoolId];
    if (fromDate) {
      query += ` AND date(ae.scanned_at) >= ?`;
      params.push(fromDate);
    }
    if (toDate) {
      query += ` AND date(ae.scanned_at) <= ?`;
      params.push(toDate);
    }
    query += ` ORDER BY ae.scanned_at DESC LIMIT 5000`;
    const records = db.prepare(query).all(...params);
    const headers = [
      "Event ID",
      "Timestamp",
      "Event Type",
      "Scan Method",
      "Status",
      "Admission Number",
      "Student Name",
      "Grade & Sec",
      "Route Code",
      "Route Name",
      "Stop Name",
      "Bus Number",
      "Scanned By",
      "Manual Reason"
    ];
    const rows = records.map((r) => [
      r.id,
      r.scanned_at,
      r.event_type,
      r.scan_method,
      r.verification_status,
      r.admission_number,
      `"${r.student_name.replace(/"/g, '""')}"`,
      `"${r.grade}-${r.section}"`,
      r.route_code,
      `"${r.route_name.replace(/"/g, '""')}"`,
      `"${(r.stop_name || "N/A").replace(/"/g, '""')}"`,
      r.bus_number,
      `"${(r.scanned_by_name || "").replace(/"/g, '""')}"`,
      `"${(r.manual_reason || "").replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    logAudit({
      schoolId,
      userId: req.user?.id,
      action: "EXPORT_ATTENDANCE_CSV",
      entityType: "REPORT",
      newValues: { rowCount: records.length, fromDate, toDate }
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-report-${schoolId}.csv"`);
    return res.send(csvContent);
  }
);
reportRoutes.get(
  "/trips-csv",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "TRANSPORT_MANAGER", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const trips = db.prepare(`
        SELECT t.id, t.trip_type, t.trip_date, t.scheduled_start_time, t.actual_start_time, t.actual_end_time, t.status,
          r.route_code, r.name as route_name,
          v.bus_number, v.registration_number,
          d.full_name as driver_name,
          (SELECT COUNT(DISTINCT ae.student_id) FROM attendance_events ae WHERE ae.trip_id = t.id AND ae.event_type = 'BOARDING') as boarded_students,
          (SELECT COUNT(DISTINCT ae.student_id) FROM attendance_events ae WHERE ae.trip_id = t.id AND ae.event_type = 'DROP_OFF') as dropped_students
        FROM trips t
        JOIN routes r ON t.route_id = r.id
        JOIN vehicles v ON t.vehicle_id = v.id
        JOIN drivers d ON t.driver_id = d.id
        WHERE t.school_id = ?
        ORDER BY t.created_at DESC
        LIMIT 2000
      `).all(schoolId);
    const headers = [
      "Trip ID",
      "Trip Type",
      "Date",
      "Scheduled Start",
      "Actual Start",
      "Actual End",
      "Status",
      "Route Code",
      "Route Name",
      "Bus Number",
      "Registration",
      "Driver Name",
      "Boarded Students",
      "Dropped Students"
    ];
    const rows = trips.map((t) => [
      t.id,
      t.trip_type,
      t.trip_date,
      t.scheduled_start_time,
      t.actual_start_time || "N/A",
      t.actual_end_time || "N/A",
      t.status,
      t.route_code,
      `"${t.route_name.replace(/"/g, '""')}"`,
      t.bus_number,
      t.registration_number,
      `"${t.driver_name.replace(/"/g, '""')}"`,
      t.boarded_students,
      t.dropped_students
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="trips-log-${schoolId}.csv"`);
    return res.send(csv);
  }
);
reportRoutes.get(
  "/safety-exceptions",
  authenticate,
  requireSchoolContext(),
  (req, res) => {
    try {
      const schoolId = req.schoolContext?.schoolId;
      if (!schoolId) {
        return res.status(400).json({ success: false, error: "NO_ACTIVE_SCHOOL", message: "Active school context required" });
      }
      const manualOverrides = db.prepare(`
          SELECT ae.*, s.full_name as student_name, s.admission_number, u.full_name as logged_by_name,
            r.name as route_name, v.bus_number
          FROM attendance_events ae
          JOIN students s ON ae.student_id = s.id
          LEFT JOIN trips t ON ae.trip_id = t.id
          LEFT JOIN routes r ON t.route_id = r.id
          LEFT JOIN vehicles v ON t.vehicle_id = v.id
          LEFT JOIN users u ON ae.scanned_by_user_id = u.id
          WHERE ae.school_id = ? AND ae.scan_method = 'MANUAL'
          ORDER BY ae.scanned_at DESC
          LIMIT 100
        `).all(schoolId);
      const speedAlerts = db.prepare(`
          SELECT bl.*, t.id as trip_id, r.name as route_name, v.bus_number, d.full_name as driver_name,
            COALESCE(ts.speed_limit_kmh, 45) as speed_limit_kmh
          FROM bus_locations bl
          JOIN trips t ON bl.trip_id = t.id
          LEFT JOIN routes r ON t.route_id = r.id
          LEFT JOIN vehicles v ON t.vehicle_id = v.id
          LEFT JOIN drivers d ON t.driver_id = d.id
          LEFT JOIN tenant_settings ts ON t.school_id = ts.school_id
          WHERE t.school_id = ? AND bl.speed_kmh > COALESCE(ts.speed_limit_kmh, 45)
          ORDER BY bl.recorded_at DESC
          LIMIT 50
        `).all(schoolId);
      const allEvents = db.prepare(`
          SELECT ae.*, s.full_name as student_name, s.admission_number, s.grade, s.section,
            r.name as route_name, r.route_code, v.bus_number, rs.stop_name, u.full_name as scanned_by_name
          FROM attendance_events ae
          JOIN students s ON ae.student_id = s.id
          LEFT JOIN trips t ON ae.trip_id = t.id
          LEFT JOIN routes r ON t.route_id = r.id
          LEFT JOIN vehicles v ON t.vehicle_id = v.id
          LEFT JOIN route_stops rs ON ae.stop_id = rs.id
          LEFT JOIN users u ON ae.scanned_by_user_id = u.id
          WHERE ae.school_id = ?
          ORDER BY ae.scanned_at DESC
          LIMIT 100
        `).all(schoolId);
      return res.json({ success: true, manualOverrides, speedAlerts, allEvents });
    } catch (err) {
      return formatSafeServerError(res, err, "FETCH_SAFETY_EXCEPTIONS");
    }
  }
);

// src/server/routes/auditRoutes.ts
import { Router as Router12 } from "express";
var auditRoutes = Router12();
auditRoutes.get(
  "/",
  authenticate,
  requireSchoolContext(["SCHOOL_ADMIN", "PLATFORM_ADMIN"]),
  (req, res) => {
    const schoolId = req.schoolContext.schoolId;
    const action = req.query.action || "";
    const entityType = req.query.entityType || "";
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const offset = (page - 1) * limit;
    let query = `
      SELECT a.*, u.full_name as user_name, u.email as user_email
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.school_id = ?
    `;
    const params = [schoolId];
    if (action) {
      query += ` AND a.action = ?`;
      params.push(action);
    }
    if (entityType) {
      query += ` AND a.entity_type = ?`;
      params.push(entityType);
    }
    const countRow = db.prepare(`SELECT COUNT(*) as total FROM (${query})`).get(...params);
    query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const logs = db.prepare(query).all(...params);
    return res.json({
      success: true,
      logs,
      pagination: {
        page,
        limit,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limit)
      }
    });
  }
);

// src/server/routes/healthRoutes.ts
import { Router as Router13 } from "express";
var healthRoutes = Router13();
healthRoutes.get("/", (req, res) => {
  const startTime = Date.now();
  let dbStatus = "CONNECTED";
  let dbLatencyMs = 0;
  try {
    const qStart = Date.now();
    db.prepare("SELECT 1 as test").get();
    dbLatencyMs = Date.now() - qStart;
  } catch (err) {
    dbStatus = "FAILED";
  }
  const isHealthy = dbStatus === "CONNECTED";
  const mem = process.memoryUsage();
  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "HEALTHY" : "DEGRADED",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      engine: "SQLite (Node 22 Built-in DatabaseSync)",
      status: dbStatus,
      latencyMs: dbLatencyMs,
      journalMode: "WAL",
      foreignKeys: "ON"
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      memoryHeapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      memoryRssMB: Math.round(mem.rss / 1024 / 1024)
    },
    version: "1.0.0-phase1"
  });
});

// src/server/routes/openapiRoutes.ts
import { Router as Router14 } from "express";
var openapiRoutes = Router14();
var openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "SurakshaVahan School Bus Tracking SaaS API",
    version: "1.0.0",
    description: "Production REST API contract for Phase 1 Web Dashboards and Phase 2 Flutter Driver & Parent Mobile Apps. Built for multi-tenant school transport management in India.",
    contact: {
      name: "SurakshaVahan Engineering",
      email: "api-support@surakshavahan.in"
    }
  },
  servers: [
    {
      url: "/api/v1",
      description: "API v1 Gateway"
    }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      },
      SchoolContext: {
        type: "apiKey",
        in: "header",
        name: "x-school-id",
        description: "Optional tenant switch header for multi-school administrators"
      }
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string", example: "VALIDATION_ERROR" },
          message: { type: "string", example: "Detailed error explanation" }
        }
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "admin@dpsrkp.net" },
          password: { type: "string", example: "Admin@12345" }
        }
      },
      GpsLocationIngestRequest: {
        type: "object",
        required: ["latitude", "longitude"],
        properties: {
          latitude: { type: "number", minimum: -90, maximum: 90, example: 28.536 },
          longitude: { type: "number", minimum: -180, maximum: 180, example: 77.2085 },
          speedKmh: { type: "number", minimum: 0, example: 34.2 },
          heading: { type: "number", minimum: 0, maximum: 360, example: 120 },
          accuracyMeters: { type: "number", example: 4.5 },
          recordedAt: { type: "string", format: "date-time" }
        }
      },
      QrScanRequest: {
        type: "object",
        required: ["qrPayload"],
        properties: {
          qrPayload: {
            type: "string",
            description: "Opaque cryptographically signed token string from student badge",
            example: "SURAKSHA_VAHAN:qr_stu_01:HASH..."
          },
          stopId: { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          preferredEventType: { type: "string", enum: ["BOARDING", "DROP_OFF"] }
        }
      },
      ManualAttendanceRequest: {
        type: "object",
        required: ["studentId", "eventType", "manualReason"],
        properties: {
          studentId: { type: "string" },
          eventType: { type: "string", enum: ["BOARDING", "DROP_OFF"] },
          manualReason: { type: "string", example: "Damaged QR card, visually verified by driver" },
          stopId: { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" }
        }
      }
    }
  },
  security: [{ BearerAuth: [] }],
  paths: {
    "/auth/login": {
      post: {
        summary: "Authenticate user and obtain JWT token",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } }
        },
        responses: {
          200: { description: "Successful login with token and active tenant context" },
          401: { description: "Invalid credentials" },
          429: { description: "Rate limit exceeded" }
        }
      }
    },
    "/auth/register-school": {
      post: {
        summary: "Self-serve onboarding for new school tenant and primary administrator",
        security: [],
        responses: { 201: { description: "School successfully registered" } }
      }
    },
    "/auth/me": {
      get: {
        summary: "Get authenticated user profile and memberships",
        responses: { 200: { description: "Profile details" } }
      }
    },
    "/schools/current": {
      get: {
        summary: "Get active school details, operational statistics, and tenant settings",
        responses: { 200: { description: "School profile & real-time counts" } }
      }
    },
    "/students": {
      get: {
        summary: "List students with filters, pagination, and transport assignment",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "grade", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } }
        ],
        responses: { 200: { description: "Paginated students list" } }
      },
      post: {
        summary: "Register student, generate opaque QR credential, and assign routes",
        responses: { 201: { description: "Student registered" } }
      }
    },
    "/trips": {
      get: {
        summary: "List trips by status (IN_PROGRESS, SCHEDULED, COMPLETED)",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "date", in: "query", schema: { type: "string" } }
        ],
        responses: { 200: { description: "List of trips" } }
      },
      post: {
        summary: "Schedule a new trip",
        responses: { 201: { description: "Trip scheduled" } }
      }
    },
    "/trips/{tripId}/start": {
      post: {
        summary: "Start trip (SCHEDULED -> IN_PROGRESS), check vehicle/driver conflicts and alert parents",
        parameters: [{ name: "tripId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Trip in progress" } }
      }
    },
    "/trips/{tripId}/complete": {
      post: {
        summary: "Complete trip with mandatory physical check confirmation & student reconciliation",
        parameters: [{ name: "tripId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Trip completed" },
          422: { description: "Reconciliation exception (missing drop-offs)" }
        }
      }
    },
    "/trips/driver/active": {
      get: {
        summary: "Get active or upcoming trip assigned to the authenticated driver (Driver App home screen)",
        responses: { 200: { description: "Assigned trip details, stops, and passenger roster" } }
      }
    },
    "/trips/{tripId}/locations": {
      post: {
        summary: "Ingest live GPS telemetry from driver or on-bus device (Driver App endpoint)",
        parameters: [{ name: "tripId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/GpsLocationIngestRequest" } } }
        },
        responses: { 201: { description: "Telemetry recorded and broadcast via WebSocket" } }
      }
    },
    "/trips/{tripId}/locations/batch": {
      post: {
        summary: "Batch ingest queued GPS coordinates upon network reconnection (Driver App offline sync)",
        parameters: [{ name: "tripId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 201: { description: "Batch telemetry ingested" } }
      }
    },
    "/trips/{tripId}/stops/{stopId}/status": {
      post: {
        summary: "Update stop progress checkpoint (ARRIVED, DEPARTED, SKIPPED) by Driver",
        parameters: [
          { name: "tripId", in: "path", required: true, schema: { type: "string" } },
          { name: "stopId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { 200: { description: "Stop status updated" } }
      }
    },
    "/trips/{tripId}/alert": {
      post: {
        summary: "Broadcast delay, breakdown, or safety alert to all guardians on trip (Driver App)",
        parameters: [{ name: "tripId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Alert dispatched to guardians" } }
      }
    },
    "/trips/{tripId}/attendance/scan": {
      post: {
        summary: "Scan student opaque QR badge for boarding or drop-off with duplicate protection (Driver App)",
        parameters: [{ name: "tripId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/QrScanRequest" } } }
        },
        responses: {
          201: { description: "Boarding or drop-off recorded and parent notified" },
          409: { description: "Duplicate or out-of-order scan exception" }
        }
      }
    },
    "/parents/children": {
      get: {
        summary: "List children linked to authenticated parent with live bus location, route, and ETA (Parent App)",
        responses: { 200: { description: "Children with assigned routes and live tracking" } }
      }
    },
    "/parents/children/{studentId}/attendance": {
      get: {
        summary: "Historical attendance records for child with stop names and timestamps (Parent App)",
        parameters: [{ name: "studentId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Attendance event history" } }
      }
    },
    "/parents/notifications": {
      get: {
        summary: "Get in-app transit notifications and alerts for authenticated parent",
        responses: { 200: { description: "Notification list" } }
      }
    },
    "/parents/device-token": {
      post: {
        summary: "Register FCM/APNs push notification token (Parent App & Driver App)",
        responses: { 200: { description: "Token registered" } }
      }
    },
    "/students/{id}/qr-badge": {
      get: {
        summary: "Generate digital ID pass and printable opaque QR code (DPDP parent-scoped)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "QR pass data and image" } }
      }
    },
    "/reports/attendance-csv": {
      get: {
        summary: "Export filtered attendance records as CSV for school authorities",
        responses: { 200: { description: "CSV file download" } }
      }
    },
    "/health": {
      get: {
        summary: "Health check probe for database, memory, and container status",
        security: [],
        responses: { 200: { description: "Service operational" } }
      }
    }
  }
};
openapiRoutes.get("/openapi.json", (req, res) => {
  return res.json(openApiSpec);
});

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
async function startServer() {
  const isProd = process.env.NODE_ENV === "production";
  validateSecurityConfig();
  runMigrations();
  await seedInitialData();
  const app = express();
  const server = http.createServer(app);
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org", "https://*.openstreetmap.org"],
          connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'", "https://aistudio.google.com", "https://*.google.com", "https://*.run.app"],
          upgradeInsecureRequests: null
        }
      },
      frameguard: false,
      // Disabled so CSP frameAncestors controls iframe embedding on Google AI Studio
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      hsts: {
        maxAge: 31536e3,
        // 1 year Strict-Transport-Security
        includeSubDomains: true,
        preload: true
      },
      noSniff: true,
      // X-Content-Type-Options: nosniff
      referrerPolicy: { policy: "strict-origin-when-cross-origin" }
    })
  );
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()) : [process.env.APP_URL || "http://localhost:3000", "http://localhost:3000", "http://127.0.0.1:3000"];
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        if (origin.includes("aistudio.google.com") || origin.includes("google.com") || origin.endsWith(".run.app") || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-school-id"]
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      console.log(`[HTTP ${req.method}] ${req.path}`);
    }
    next();
  });
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/schools", schoolRoutes);
  app.use("/api/v1/students", studentRoutes);
  app.use("/api/v1/vehicles", vehicleRoutes);
  app.use("/api/v1/drivers", driverRoutes);
  app.use("/api/v1/routes", routeRoutes);
  app.use("/api/v1/trips", tripRoutes);
  app.use("/api/v1/trips", locationRoutes);
  app.use("/api/v1/trips", attendanceRoutes);
  app.use("/api/v1/parents", parentRoutes);
  app.use("/api/v1/reports", reportRoutes);
  app.use("/api/v1/audit-logs", auditRoutes);
  app.use("/api/v1/health", healthRoutes);
  app.use("/api/v1", openapiRoutes);
  app.use((err, _req, res, _next) => {
    const correlationId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    console.error(`[Unhandled Error] [Correlation ID: ${correlationId}]`, err);
    if (res.headersSent) {
      return;
    }
    const statusCode = typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(statusCode).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
      message: "An internal server error occurred. Please contact support with the correlation ID.",
      correlationId
    });
  });
  initWebSocketServer(server);
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path2.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path2.resolve(__dirname, "dist", "index.html"));
    });
  }
  const PORT = parseInt(process.env.PORT || "3000", 10);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[SurakshaVahan Server] Running at http://localhost:${PORT}`);
    console.log(`[SurakshaVahan Server] REST API at http://localhost:${PORT}/api/v1`);
    console.log(`[SurakshaVahan Server] WebSocket Stream at ws://localhost:${PORT}/ws`);
  });
}
startServer().catch((err) => {
  console.error("[Server Startup Fatal Error]", err);
  process.exit(1);
});
