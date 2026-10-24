import express from 'express';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { validateSecurityConfig } from './src/server/securityConfig.ts';
import { runMigrations } from './src/server/schema.ts';
import { seedInitialData } from './src/server/seed.ts';
import { initWebSocketServer } from './src/server/websocket.ts';

// Routes
import { authRoutes } from './src/server/routes/authRoutes.ts';
import { schoolRoutes } from './src/server/routes/schoolRoutes.ts';
import { studentRoutes } from './src/server/routes/studentRoutes.ts';
import { vehicleRoutes } from './src/server/routes/vehicleRoutes.ts';
import { driverRoutes } from './src/server/routes/driverRoutes.ts';
import { routeRoutes } from './src/server/routes/routeRoutes.ts';
import { tripRoutes } from './src/server/routes/tripRoutes.ts';
import { locationRoutes } from './src/server/routes/locationRoutes.ts';
import { attendanceRoutes } from './src/server/routes/attendanceRoutes.ts';
import { parentRoutes } from './src/server/routes/parentRoutes.ts';
import { reportRoutes } from './src/server/routes/reportRoutes.ts';
import { auditRoutes } from './src/server/routes/auditRoutes.ts';
import { healthRoutes } from './src/server/routes/healthRoutes.ts';
import { openapiRoutes } from './src/server/routes/openapiRoutes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  // 0. Validate production security invariants (JWT secret entropy, seed guard)
  validateSecurityConfig();

  // 1. Database migrations and initial seed
  runMigrations();
  await seedInitialData();

  const app = express();
  const server = http.createServer(app);

  // Trust proxy for accurate client IP resolution behind Cloud Run / NGINX reverse proxies
  app.set('trust proxy', 1);

  // Production security headers via Helmet
  // Configured to permit embedding in Google AI Studio preview iframe while securing all other surfaces
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://*.openstreetmap.org'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'", 'https://aistudio.google.com', 'https://*.google.com', 'https://*.run.app'],
          upgradeInsecureRequests: null,
        },
      },
      frameguard: false, // Disabled so CSP frameAncestors controls iframe embedding on Google AI Studio
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      hsts: {
        maxAge: 31536000, // 1 year Strict-Transport-Security
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true, // X-Content-Type-Options: nosniff
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // Restricted CORS configuration (No wildcard '*' allowed)
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [process.env.APP_URL || 'http://localhost:3000', 'http://localhost:3000', 'http://127.0.0.1:3000'];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, same-origin, native apps)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // In preview environments, allow valid Google Cloud Run development app URLs or localhost
        if (
          origin.includes('aistudio.google.com') ||
          origin.includes('google.com') ||
          origin.endsWith('.run.app') ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:')
        ) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-school-id'],
    })
  );

  app.use(express.json({ limit: '2mb', inflate: false }));
  app.use(express.urlencoded({ extended: true, limit: '2mb', inflate: false }));

  // Request logger (clean, no PII)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[HTTP ${req.method}] ${req.path}`);
    }
    next();
  });

  // 2. Mount API v1 Routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/schools', schoolRoutes);
  app.use('/api/v1/students', studentRoutes);
  app.use('/api/v1/vehicles', vehicleRoutes);
  app.use('/api/v1/drivers', driverRoutes);
  app.use('/api/v1/routes', routeRoutes);
  app.use('/api/v1/trips', tripRoutes);
  app.use('/api/v1/trips', locationRoutes);
  app.use('/api/v1/trips', attendanceRoutes);
  app.use('/api/v1/parents', parentRoutes);
  app.use('/api/v1/reports', reportRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  app.use('/api/v1/health', healthRoutes);
  app.use('/api/v1', openapiRoutes);

  // 3. Centralized error handling middleware (generic response + correlation ID, detailed logs server-side only)
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const correlationId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    console.error(`[Unhandled Error] [Correlation ID: ${correlationId}]`, err);

    if (res.headersSent) {
      return;
    }

    const statusCode = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(statusCode).json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An internal server error occurred. Please contact support with the correlation ID.',
      correlationId,
    });
  });

  // 4. Initialize WebSocket Server on /ws
  initWebSocketServer(server);

  // 5. Mount Vite middleware for dev SPA or serve static dist in prod
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = parseInt(process.env.PORT || '3000', 10);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SurakshaVahan Server] Running at http://localhost:${PORT}`);
    console.log(`[SurakshaVahan Server] REST API at http://localhost:${PORT}/api/v1`);
    console.log(`[SurakshaVahan Server] WebSocket Stream at ws://localhost:${PORT}/ws`);
  });
}

startServer().catch((err) => {
  console.error('[Server Startup Fatal Error]', err);
  process.exit(1);
});
