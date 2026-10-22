import { Router, Request, Response } from 'express';

export const openapiRoutes = Router();

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SurakshaVahan School Bus Tracking SaaS API',
    version: '1.0.0',
    description:
      'Production REST API contract for Phase 1 Web Dashboards and Phase 2 Flutter Driver & Parent Mobile Apps. Built for multi-tenant school transport management in India.',
    contact: {
      name: 'SurakshaVahan Engineering',
      email: 'api-support@surakshavahan.in',
    },
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API v1 Gateway',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      SchoolContext: {
        type: 'apiKey',
        in: 'header',
        name: 'x-school-id',
        description: 'Optional tenant switch header for multi-school administrators',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string', example: 'Detailed error explanation' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'admin@dpsrkp.net' },
          password: { type: 'string', example: 'Admin@12345' },
        },
      },
      GpsLocationIngestRequest: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90, example: 28.536 },
          longitude: { type: 'number', minimum: -180, maximum: 180, example: 77.2085 },
          speedKmh: { type: 'number', minimum: 0, example: 34.2 },
          heading: { type: 'number', minimum: 0, maximum: 360, example: 120 },
          accuracyMeters: { type: 'number', example: 4.5 },
          recordedAt: { type: 'string', format: 'date-time' },
        },
      },
      QrScanRequest: {
        type: 'object',
        required: ['qrPayload'],
        properties: {
          qrPayload: {
            type: 'string',
            description: 'Opaque cryptographically signed token string from student badge',
            example: 'SURAKSHA_VAHAN:qr_stu_01:HASH...',
          },
          stopId: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          preferredEventType: { type: 'string', enum: ['BOARDING', 'DROP_OFF'] },
        },
      },
      ManualAttendanceRequest: {
        type: 'object',
        required: ['studentId', 'eventType', 'manualReason'],
        properties: {
          studentId: { type: 'string' },
          eventType: { type: 'string', enum: ['BOARDING', 'DROP_OFF'] },
          manualReason: { type: 'string', example: 'Damaged QR card, visually verified by driver' },
          stopId: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/auth/login': {
      post: {
        summary: 'Authenticate user and obtain JWT token',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: {
          200: { description: 'Successful login with token and active tenant context' },
          401: { description: 'Invalid credentials' },
          429: { description: 'Rate limit exceeded' },
        },
      },
    },
    '/auth/register-school': {
      post: {
        summary: 'Self-serve onboarding for new school tenant and primary administrator',
        security: [],
        responses: { 201: { description: 'School successfully registered' } },
      },
    },
    '/auth/me': {
      get: {
        summary: 'Get authenticated user profile and memberships',
        responses: { 200: { description: 'Profile details' } },
      },
    },
    '/schools/current': {
      get: {
        summary: 'Get active school details, operational statistics, and tenant settings',
        responses: { 200: { description: 'School profile & real-time counts' } },
      },
    },
    '/students': {
      get: {
        summary: 'List students with filters, pagination, and transport assignment',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'grade', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Paginated students list' } },
      },
      post: {
        summary: 'Register student, generate opaque QR credential, and assign routes',
        responses: { 201: { description: 'Student registered' } },
      },
    },
    '/trips': {
      get: {
        summary: 'List trips by status (IN_PROGRESS, SCHEDULED, COMPLETED)',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'date', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'List of trips' } },
      },
      post: {
        summary: 'Schedule a new trip',
        responses: { 201: { description: 'Trip scheduled' } },
      },
    },
    '/trips/{tripId}/start': {
      post: {
        summary: 'Start trip (SCHEDULED -> IN_PROGRESS), check vehicle/driver conflicts and alert parents',
        parameters: [{ name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Trip in progress' } },
      },
    },
    '/trips/{tripId}/complete': {
      post: {
        summary: 'Complete trip with mandatory physical check confirmation & student reconciliation',
        parameters: [{ name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Trip completed' },
          422: { description: 'Reconciliation exception (missing drop-offs)' },
        },
      },
    },
    '/trips/driver/active': {
      get: {
        summary: 'Get active or upcoming trip assigned to the authenticated driver (Driver App home screen)',
        responses: { 200: { description: 'Assigned trip details, stops, and passenger roster' } },
      },
    },
    '/trips/{tripId}/locations': {
      post: {
        summary: 'Ingest live GPS telemetry from driver or on-bus device (Driver App endpoint)',
        parameters: [{ name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GpsLocationIngestRequest' } } },
        },
        responses: { 201: { description: 'Telemetry recorded and broadcast via WebSocket' } },
      },
    },
    '/trips/{tripId}/locations/batch': {
      post: {
        summary: 'Batch ingest queued GPS coordinates upon network reconnection (Driver App offline sync)',
        parameters: [{ name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 201: { description: 'Batch telemetry ingested' } },
      },
    },
    '/trips/{tripId}/stops/{stopId}/status': {
      post: {
        summary: 'Update stop progress checkpoint (ARRIVED, DEPARTED, SKIPPED) by Driver',
        parameters: [
          { name: 'tripId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'stopId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Stop status updated' } },
      },
    },
    '/trips/{tripId}/alert': {
      post: {
        summary: 'Broadcast delay, breakdown, or safety alert to all guardians on trip (Driver App)',
        parameters: [{ name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Alert dispatched to guardians' } },
      },
    },
    '/trips/{tripId}/attendance/scan': {
      post: {
        summary: 'Scan student opaque QR badge for boarding or drop-off with duplicate protection (Driver App)',
        parameters: [{ name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/QrScanRequest' } } },
        },
        responses: {
          201: { description: 'Boarding or drop-off recorded and parent notified' },
          409: { description: 'Duplicate or out-of-order scan exception' },
        },
      },
    },
    '/parents/children': {
      get: {
        summary: 'List children linked to authenticated parent with live bus location, route, and ETA (Parent App)',
        responses: { 200: { description: 'Children with assigned routes and live tracking' } },
      },
    },
    '/parents/children/{studentId}/attendance': {
      get: {
        summary: 'Historical attendance records for child with stop names and timestamps (Parent App)',
        parameters: [{ name: 'studentId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Attendance event history' } },
      },
    },
    '/parents/notifications': {
      get: {
        summary: 'Get in-app transit notifications and alerts for authenticated parent',
        responses: { 200: { description: 'Notification list' } },
      },
    },
    '/parents/device-token': {
      post: {
        summary: 'Register FCM/APNs push notification token (Parent App & Driver App)',
        responses: { 200: { description: 'Token registered' } },
      },
    },
    '/students/{id}/qr-badge': {
      get: {
        summary: 'Generate digital ID pass and printable opaque QR code (DPDP parent-scoped)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'QR pass data and image' } },
      },
    },
    '/reports/attendance-csv': {
      get: {
        summary: 'Export filtered attendance records as CSV for school authorities',
        responses: { 200: { description: 'CSV file download' } },
      },
    },
    '/health': {
      get: {
        summary: 'Health check probe for database, memory, and container status',
        security: [],
        responses: { 200: { description: 'Service operational' } },
      },
    },
  },
};

openapiRoutes.get('/openapi.json', (req: Request, res: Response) => {
  return res.json(openApiSpec);
});
