import { db } from './db.ts';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { validateSecurityConfig } from './securityConfig.ts';

export async function seedInitialData() {
  const config = validateSecurityConfig();

  // In production, NEVER seed sample demo data
  if (config.isProduction) {
    console.log('[Seed] Production environment detected: Sample demo data seeding is strictly skipped.');
    return;
  }

  // In development/test, require explicit opt-in via SEED_SAMPLE_DATA=true
  if (!config.seedSampleData) {
    console.log('[Seed] SEED_SAMPLE_DATA is not set to true. Skipping sample data population.');
    return;
  }

  const existingSchools = db.prepare('SELECT COUNT(*) as count FROM schools').get() as { count: number };
  if (existingSchools.count > 0) {
    console.log('[Seed] Database already initialized with schools.');
    return;
  }

  console.log('[Seed] SEED_SAMPLE_DATA=true verified: Seeding initial demo schools, buses, and test personas...');

  const defaultPasswordHash = await bcrypt.hash('Admin@12345', 10);
  const driverPasswordHash = await bcrypt.hash('Driver@12345', 10);
  const parentPasswordHash = await bcrypt.hash('Parent@12345', 10);

  // 1. Platform Super Admin User
  const platformAdminId = 'usr_plat_admin';
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'PLATFORM_ADMIN', 1)
  `).run(platformAdminId, 'platform.admin@surakshavahan.in', defaultPasswordHash, 'Vikram Malhotra', '+91 98100 11223');

  // 2. School A: Delhi Public School, R.K. Puram (New Delhi)
  const schoolAId = 'sch_dps_rkp';
  db.prepare(`
    INSERT INTO schools (id, code, name, affiliation_number, board, address, city, state, pincode, contact_phone, contact_email, timezone, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolAId,
    'DPS-RKP',
    'Delhi Public School, R.K. Puram',
    'CBSE/AFF/2730015',
    'CBSE',
    'Sector XII, R.K. Puram',
    'New Delhi',
    'Delhi',
    '110022',
    '+91 11 4911 5555',
    'transport@dpsrkp.net',
    'Asia/Kolkata',
    'ACTIVE'
  );

  // Tenant Settings & Subscriptions for School A
  db.prepare(`
    INSERT INTO tenant_settings (school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance, strict_reconciliation_required)
    VALUES (?, 45, 50, 1, 1)
  `).run(schoolAId);

  db.prepare(`
    INSERT INTO subscriptions (id, school_id, plan_name, status, max_vehicles, max_students, expires_at)
    VALUES (?, ?, 'ENTERPRISE', 'ACTIVE', 50, 3000, '2027-12-31')
  `).run('sub_dps_rkp', schoolAId);

  // School A Admin User
  const schoolAAdminId = 'usr_dps_admin';
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(schoolAAdminId, 'admin@dpsrkp.net', defaultPasswordHash, 'Rajesh Sharma', '+91 98111 22334');

  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'SCHOOL_ADMIN', 'ACTIVE')
  `).run('mem_dps_admin', schoolAAdminId, schoolAId);

  // School A Transport Manager
  const schoolATmId = 'usr_dps_tm';
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(schoolATmId, 'transport.manager@dpsrkp.net', defaultPasswordHash, 'Suresh Verma', '+91 98111 33445');

  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'TRANSPORT_MANAGER', 'ACTIVE')
  `).run('mem_dps_tm', schoolATmId, schoolAId);

  // School A Drivers & Vehicles
  const vehA1Id = 'veh_dps_01';
  db.prepare(`
    INSERT INTO vehicles (id, school_id, registration_number, bus_number, capacity, model, make, fuel_type, fitness_expiry, insurance_expiry, gps_device_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vehA1Id,
    schoolAId,
    'DL-01-EB-4102',
    'Bus #01',
    42,
    'Starbus Ultra 42S',
    'Tata Motors',
    'CNG',
    '2027-06-30',
    '2027-04-15',
    'GPS-DEVICE-DEL-01',
    'ACTIVE'
  );

  const vehA2Id = 'veh_dps_02';
  db.prepare(`
    INSERT INTO vehicles (id, school_id, registration_number, bus_number, capacity, model, make, fuel_type, fitness_expiry, insurance_expiry, gps_device_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vehA2Id,
    schoolAId,
    'DL-01-EB-4105',
    'Bus #02',
    35,
    'Skool Bus 35S',
    'Ashok Leyland',
    'CNG',
    '2027-08-30',
    '2027-05-20',
    'GPS-DEVICE-DEL-02',
    'ACTIVE'
  );

  // Driver User & Profile for School A
  const driverA1UserId = 'usr_dps_driver1';
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(driverA1UserId, 'driver.ramesh@dpsrkp.net', driverPasswordHash, 'Ramesh Kumar', '+91 98765 43210');

  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'DRIVER', 'ACTIVE')
  `).run('mem_dps_driver1', driverA1UserId, schoolAId);

  const driverA1Id = 'drv_dps_01';
  db.prepare(`
    INSERT INTO drivers (id, school_id, user_id, full_name, phone, license_number, license_expiry, badge_number, emergency_contact, blood_group, years_experience, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    driverA1Id,
    schoolAId,
    driverA1UserId,
    'Ramesh Kumar',
    '+91 98765 43210',
    'DL-0420110023456',
    '2029-10-15',
    'COMM-BDG-9842',
    '+91 98765 43219',
    'B+',
    12,
    'ACTIVE'
  );

  // Route 1 for School A (South Delhi - Saket to RKP)
  const routeA1Id = 'rt_dps_101';
  db.prepare(`
    INSERT INTO routes (id, school_id, route_code, name, description, morning_start_time, evening_start_time, default_vehicle_id, default_driver_id, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    routeA1Id,
    schoolAId,
    'R-101',
    'Saket - Hauz Khas - RKP Express',
    'Serves Saket Metro, Malviya Nagar, and Hauz Khas en route to Sector 12',
    '06:45',
    '14:15',
    vehA1Id,
    driverA1Id
  );

  // Stops for Route 1 (Real coordinates in South Delhi)
  const stopsData = [
    { name: 'Saket Metro Station (Gate 2)', landmark: 'Opposite Select Citywalk', lat: 28.5204, lng: 77.2014, seq: 1, mTime: '06:45', eTime: '15:10' },
    { name: 'Malviya Nagar Market', landmark: 'Corner Gol Chakkar', lat: 28.5355, lng: 77.2081, seq: 2, mTime: '06:55', eTime: '15:00' },
    { name: 'Hauz Khas Enclave Main Gate', landmark: 'Near Aurobindo Marg', lat: 28.5494, lng: 77.2065, seq: 3, mTime: '07:10', eTime: '14:45' },
    { name: 'IIT Flyover Crossing', landmark: 'IIT Delhi Gate', lat: 28.5449, lng: 77.1926, seq: 4, mTime: '07:22', eTime: '14:32' },
    { name: 'DPS R.K. Puram Campus Gate 1', landmark: 'School Arrival Porch', lat: 28.5672, lng: 77.1723, seq: 5, mTime: '07:35', eTime: '14:15' }
  ];

  const stopIds: string[] = [];
  stopsData.forEach((st, idx) => {
    const stopId = `stp_dps_101_${idx + 1}`;
    stopIds.push(stopId);
    db.prepare(`
      INSERT INTO route_stops (id, route_id, stop_name, landmark, latitude, longitude, sequence_order, morning_scheduled_time, evening_scheduled_time, geofence_radius_meters)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 50)
    `).run(stopId, routeA1Id, st.name, st.landmark, st.lat, st.lng, st.seq, st.mTime, st.eTime);
  });

  // Students for School A
  const studentsData = [
    { id: 'stu_dps_01', adm: 'DPS-2022-0412', name: 'Aarav Sharma', grade: '5', sec: 'A', blood: 'O+', emPhone: '+91 98111 88990', stopIdx: 0 },
    { id: 'stu_dps_02', adm: 'DPS-2021-0234', name: 'Diya Patel', grade: '7', sec: 'B', blood: 'B+', emPhone: '+91 98111 88991', stopIdx: 1 },
    { id: 'stu_dps_03', adm: 'DPS-2023-0891', name: 'Kabir Verma', grade: '3', sec: 'C', blood: 'A+', emPhone: '+91 98111 88992', stopIdx: 2 },
    { id: 'stu_dps_04', adm: 'DPS-2020-0112', name: 'Ananya Gupta', grade: '8', sec: 'A', blood: 'AB+', emPhone: '+91 98111 88993', stopIdx: 3 }
  ];

  // Guardian user (Parent)
  const parentUserId = 'usr_dps_parent1';
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(parentUserId, 'parent.sharma@gmail.com', parentPasswordHash, 'Amit Sharma', '+91 98111 88990');

  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'PARENT', 'ACTIVE')
  `).run('mem_dps_parent1', parentUserId, schoolAId);

  const guardian1Id = 'grd_dps_01';
  db.prepare(`
    INSERT INTO guardians (id, user_id, full_name, phone, email, relationship, address)
    VALUES (?, ?, ?, ?, ?, 'FATHER', 'Pocket B, Saket, New Delhi')
  `).run(guardian1Id, parentUserId, 'Amit Sharma', '+91 98111 88990', 'parent.sharma@gmail.com');

  studentsData.forEach((st) => {
    db.prepare(`
      INSERT INTO students (id, school_id, admission_number, full_name, grade, section, blood_group, emergency_phone, home_address, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(st.id, schoolAId, st.adm, st.name, st.grade, st.sec, st.blood, st.emPhone, 'New Delhi');

    // Transport assignment
    db.prepare(`
      INSERT INTO transport_assignments (id, school_id, student_id, morning_route_id, morning_stop_id, evening_route_id, evening_stop_id, academic_year, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, '2026-2027', 1)
    `).run(`ta_${st.id}`, schoolAId, st.id, routeA1Id, stopIds[st.stopIdx], routeA1Id, stopIds[st.stopIdx]);

    // Generate cryptographic opaque QR credential (NOT containing student PII directly)
    const opaqueToken = `SVQR_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(opaqueToken).digest('hex');
    const tokenHint = `SV-QR-${opaqueToken.substring(5, 9).toUpperCase()}`;

    db.prepare(`
      INSERT INTO qr_credentials (id, school_id, student_id, token_hash, token_hint, expires_at, is_revoked)
      VALUES (?, ?, ?, ?, ?, '2027-03-31', 0)
    `).run(`qr_${st.id}`, schoolAId, st.id, tokenHash, tokenHint);
  });

  // Link Aarav Sharma to guardian Amit Sharma
  db.prepare(`
    INSERT INTO student_guardians (id, student_id, guardian_id, is_primary, can_pickup, relationship_type)
    VALUES (?, ?, ?, 1, 1, 'FATHER')
  `).run('sg_01', 'stu_dps_01', guardian1Id);

  // Guardian user 2 (Sunita Patel for Diya Patel)
  const parent2UserId = 'usr_dps_parent2';
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(parent2UserId, 'parent.patel@gmail.com', parentPasswordHash, 'Sunita Patel', '+91 98111 88991');

  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'PARENT', 'ACTIVE')
  `).run('mem_dps_parent2', parent2UserId, schoolAId);

  const guardian2Id = 'grd_dps_02';
  db.prepare(`
    INSERT INTO guardians (id, user_id, full_name, phone, email, relationship, address)
    VALUES (?, ?, ?, ?, ?, 'MOTHER', 'Block C, Saket, New Delhi')
  `).run(guardian2Id, parent2UserId, 'Sunita Patel', '+91 98111 88991', 'parent.patel@gmail.com');

  db.prepare(`
    INSERT INTO student_guardians (id, student_id, guardian_id, is_primary, can_pickup, relationship_type)
    VALUES (?, ?, ?, 1, 1, 'MOTHER')
  `).run('sg_02', 'stu_dps_02', guardian2Id);

  // Create an active / in-progress trip for today to enable live tracking right away
  const todayDate = new Date().toISOString().split('T')[0];
  const tripA1Id = 'trip_dps_today_morning';
  db.prepare(`
    INSERT INTO trips (id, school_id, route_id, vehicle_id, driver_id, trip_type, trip_date, scheduled_start_time, actual_start_time, status, started_by_user_id)
    VALUES (?, ?, ?, ?, ?, 'MORNING_PICKUP', ?, '06:45', datetime('now', '-25 minutes'), 'IN_PROGRESS', ?)
  `).run(tripA1Id, schoolAId, routeA1Id, vehA1Id, driverA1Id, todayDate, driverA1UserId);

  // Populate trip stops
  stopIds.forEach((sid, idx) => {
    const status = idx === 0 ? 'DEPARTED' : idx === 1 ? 'ARRIVED' : 'PENDING';
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

  // Add initial live location for Bus #01 near Malviya Nagar
  db.prepare(`
    INSERT INTO bus_locations (id, trip_id, vehicle_id, latitude, longitude, speed_kmh, heading, accuracy_meters, recorded_at)
    VALUES (?, ?, ?, 28.5360, 77.2085, 32.5, 345, 4.2, datetime('now'))
  `).run(`loc_${Date.now()}`, tripA1Id, vehA1Id);

  // Record boarding for student Aarav Sharma at Stop 1
  db.prepare(`
    INSERT INTO attendance_events (id, school_id, trip_id, student_id, stop_id, event_type, scan_method, scanned_by_user_id, scanned_at, latitude, longitude, verification_status)
    VALUES (?, ?, ?, ?, ?, 'BOARDING', 'QR', ?, datetime('now', '-20 minutes'), 28.5205, 77.2015, 'VERIFIED')
  `).run(`att_${Date.now()}`, schoolAId, tripA1Id, 'stu_dps_01', stopIds[0], driverA1UserId);

  // Initial notification for parent (Truthful in-app delivery state)
  db.prepare(`
    INSERT INTO notifications (
      id, school_id, user_id, title, message, notification_type,
      related_trip_id, related_student_id, delivery_status, channel,
      delivery_provider, provider_response
    )
    VALUES (?, ?, ?, 'Bus Boarding Confirmed', 'Aarav Sharma safely boarded Bus #01 at Saket Metro Station.', 'BOARDING', ?, 'stu_dps_01', 'DELIVERED_IN_APP', 'IN_APP', 'SURAKSHAVAHAN_INTERNAL', 'Delivered to parent dashboard')
  `).run(`notif_${Date.now()}`, schoolAId, parentUserId, tripA1Id);

  // ---------------------------------------------------------
  // 3. School B: Ryan International School, Vasant Kunj (Tenant Isolation Proof)
  // ---------------------------------------------------------
  const schoolBId = 'sch_ryan_vk';
  db.prepare(`
    INSERT INTO schools (id, code, name, affiliation_number, board, address, city, state, pincode, contact_phone, contact_email, timezone, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolBId,
    'RYAN-VK',
    'Ryan International School, Vasant Kunj',
    'CBSE/AFF/2730198',
    'CBSE',
    'Sector C, Pocket 8, Vasant Kunj',
    'New Delhi',
    'Delhi',
    '110070',
    '+91 11 2689 3333',
    'admin@ryanvasantkunj.edu.in',
    'Asia/Kolkata',
    'ACTIVE'
  );

  db.prepare(`
    INSERT INTO tenant_settings (school_id, speed_limit_kmh, geofence_buffer_meters, allow_manual_attendance, strict_reconciliation_required)
    VALUES (?, 40, 50, 1, 1)
  `).run(schoolBId);

  db.prepare(`
    INSERT INTO subscriptions (id, school_id, plan_name, status, max_vehicles, max_students, expires_at)
    VALUES (?, ?, 'PROFESSIONAL', 'ACTIVE', 20, 1000, '2027-10-31')
  `).run('sub_ryan_vk', schoolBId);

  const schoolBAdminId = 'usr_ryan_admin';
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, system_role, is_active)
    VALUES (?, ?, ?, ?, ?, 'USER', 1)
  `).run(schoolBAdminId, 'admin@ryanvasantkunj.edu.in', defaultPasswordHash, 'Meenakshi Iyer', '+91 98222 33445');

  db.prepare(`
    INSERT INTO school_memberships (id, user_id, school_id, role, status)
    VALUES (?, ?, ?, 'SCHOOL_ADMIN', 'ACTIVE')
  `).run('mem_ryan_admin', schoolBAdminId, schoolBId);

  const vehB1Id = 'veh_ryan_01';
  db.prepare(`
    INSERT INTO vehicles (id, school_id, registration_number, bus_number, capacity, model, make, fuel_type, fitness_expiry, insurance_expiry, gps_device_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vehB1Id,
    schoolBId,
    'DL-02-CB-9081',
    'Bus #10',
    38,
    'SML Isuzu Executive',
    'SML Isuzu',
    'CNG',
    '2027-09-15',
    '2027-08-01',
    'GPS-DEVICE-DEL-10',
    'ACTIVE'
  );

  db.prepare(`
    INSERT INTO students (id, school_id, admission_number, full_name, grade, section, blood_group, emergency_phone, home_address, status)
    VALUES (?, ?, 'RYAN-2023-0099', 'Rohan Mehra', '6', 'B', 'B+', '+91 98333 44556', 'Vasant Vihar, New Delhi', 'ACTIVE')
  `).run('stu_ryan_01', schoolBId);

  console.log('[Seed] Multi-tenant initial data successfully seeded.');
}
