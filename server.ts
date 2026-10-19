import express from 'express';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
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
  // 0. Validate production security invariants (JWT secret entropy, seed guard)
  validateSecurityConfig();

  // 1. Database migrations and initial seed
  runMigrations();
  await seedInitialData();

  const app = express();
  const server = http.createServer(app);

  // Trust proxy for accurate client IP resolution behind Cloud Run / NGINX reverse proxies
  app.set('trust proxy', 1);

  // Production security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(cors());
  app.use(express.json());

  // Request logger
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

  // 3. Initialize WebSocket Server on /ws
  initWebSocketServer(server);

  // 4. Mount Vite middleware for dev SPA or serve static dist in prod
  const isProd = process.env.NODE_ENV === 'production';
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
