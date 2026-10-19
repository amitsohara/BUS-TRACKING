import { Router, Request, Response } from 'express';
import { db } from '../db.ts';

export const healthRoutes = Router();

healthRoutes.get('/', (req: Request, res: Response) => {
  const startTime = Date.now();
  let dbStatus = 'CONNECTED';
  let dbLatencyMs = 0;

  try {
    const qStart = Date.now();
    db.prepare('SELECT 1 as test').get();
    dbLatencyMs = Date.now() - qStart;
  } catch (err: any) {
    dbStatus = 'FAILED';
  }

  const isHealthy = dbStatus === 'CONNECTED';
  const mem = process.memoryUsage();

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'HEALTHY' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      engine: 'SQLite (Node 22 Built-in DatabaseSync)',
      status: dbStatus,
      latencyMs: dbLatencyMs,
      journalMode: 'WAL',
      foreignKeys: 'ON',
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      memoryHeapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      memoryRssMB: Math.round(mem.rss / 1024 / 1024),
    },
    version: '1.0.0-phase1',
  });
});
