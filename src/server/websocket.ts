import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { db } from './db.ts';
import { getJwtSecret } from './securityConfig.ts';

interface ClientConnection {
  ws: WebSocket;
  userId: string;
  systemRole: string;
  schoolId?: string;
  role?: string;
  subscriptions: Set<string>; // Set of channels, e.g. "trip:TRIP_ID"
  isAlive: boolean;
}

const activeClients = new Map<WebSocket, ClientConnection>();

/**
 * Validates whether an authenticated WebSocket client is permitted to subscribe
 * to telemetry and updates for a given tripId.
 * Rules:
 * - PLATFORM_ADMIN can monitor any trip.
 * - SCHOOL_ADMIN / TRANSPORT_MANAGER / DRIVER can only monitor trips of their own school.
 * - PARENT can only monitor trips containing a route assigned to their registered child.
 * - Anonymous / unauthenticated clients are denied subscription.
 */
export function checkTripSubscriptionAccess(client: ClientConnection, tripId: string): boolean {
  if (!client.userId || client.userId === 'anonymous') {
    return false;
  }

  if (client.systemRole === 'PLATFORM_ADMIN') {
    return true;
  }

  const trip = db.prepare('SELECT id, school_id, route_id, driver_id FROM trips WHERE id = ?').get(tripId) as any;
  if (!trip) {
    return false;
  }

  // 1. School Staff (Admin, Transport Manager, Driver)
  if (client.schoolId && client.schoolId === trip.school_id) {
    if (client.role === 'DRIVER') {
      // Driver must be assigned to this trip or belong to the school fleet
      const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ? AND school_id = ?').get(client.userId, client.schoolId) as any;
      if (driver && driver.id === trip.driver_id) {
        return true;
      }
    }
    if (['SCHOOL_ADMIN', 'TRANSPORT_MANAGER'].includes(client.role || '')) {
      return true;
    }
  }

  // 2. Parent: check if parent's child is assigned to this trip's route
  const isLinkedParent = db
    .prepare(`
      SELECT 1 FROM student_guardians sg
      JOIN guardians g ON sg.guardian_id = g.id
      JOIN transport_assignments ta ON sg.student_id = ta.student_id
      WHERE g.user_id = ?
        AND (ta.morning_route_id = ? OR ta.evening_route_id = ?)
        AND ta.is_active = 1
      LIMIT 1
    `)
    .get(client.userId, trip.route_id, trip.route_id);

  if (isLinkedParent) {
    return true;
  }

  return false;
}

export function initWebSocketServer(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    let userId = 'anonymous';
    let systemRole = 'ANONYMOUS';
    let schoolId: string | undefined = undefined;
    let role: string | undefined = undefined;

    if (token) {
      try {
        const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as any;
        userId = decoded.sub;
        systemRole = decoded.systemRole;
        schoolId = decoded.schoolId || undefined;
        role = decoded.role || undefined;
      } catch (err) {
        // Token invalid or expired
      }
    }

    const client: ClientConnection = {
      ws,
      userId,
      systemRole,
      schoolId,
      role,
      subscriptions: new Set<string>(),
      isAlive: true,
    };

    activeClients.set(ws, client);

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, payload } = message;

        switch (type) {
          case 'SUBSCRIBE_TRIP': {
            if (payload && payload.tripId) {
              const allowed = checkTripSubscriptionAccess(client, payload.tripId);
              if (!allowed) {
                ws.send(
                  JSON.stringify({
                    type: 'ERROR',
                    payload: {
                      error: 'SUBSCRIPTION_FORBIDDEN',
                      message: `Unauthorized subscription attempt for trip: ${payload.tripId}`,
                    },
                  })
                );
                break;
              }
              const channel = `trip:${payload.tripId}`;
              client.subscriptions.add(channel);
              ws.send(JSON.stringify({ type: 'SUBSCRIBED', payload: { channel } }));
            }
            break;
          }
          case 'UNSUBSCRIBE_TRIP': {
            if (payload && payload.tripId) {
              const channel = `trip:${payload.tripId}`;
              client.subscriptions.delete(channel);
              ws.send(JSON.stringify({ type: 'UNSUBSCRIBED', payload: { channel } }));
            }
            break;
          }
          case 'PING': {
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
            break;
          }
          default:
            break;
        }
      } catch (e) {
        // ignore malformed message
      }
    });

    ws.on('close', () => {
      activeClients.delete(ws);
    });

    ws.on('error', () => {
      activeClients.delete(ws);
    });

    // Send connection greeting with server status
    ws.send(
      JSON.stringify({
        type: 'CONNECTED',
        payload: {
          serverTime: new Date().toISOString(),
          userId,
          message: 'Connected to SurakshaVahan Real-Time GPS & Trip Stream',
        },
      })
    );
  });

  // Heartbeat check every 30 seconds
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
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  console.log('[WebSocket] Real-time engine initialized on /ws');
}

// Broadcast location update to all authorized subscribers of trip
export function broadcastTripLocation(tripId: string, locationData: any) {
  const channel = `trip:${tripId}`;
  const message = JSON.stringify({
    type: 'LOCATION_UPDATE',
    tripId,
    payload: locationData,
  });

  activeClients.forEach((client) => {
    if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

// Broadcast attendance event (boarding / drop off)
export function broadcastAttendanceEvent(tripId: string, attendanceData: any) {
  const channel = `trip:${tripId}`;
  const message = JSON.stringify({
    type: 'ATTENDANCE_EVENT',
    tripId,
    payload: attendanceData,
  });

  activeClients.forEach((client) => {
    if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

// Broadcast trip status transition
export function broadcastTripStatusChange(tripId: string, status: string, metadata: any = {}) {
  const channel = `trip:${tripId}`;
  const message = JSON.stringify({
    type: 'TRIP_STATUS_CHANGED',
    tripId,
    payload: { status, ...metadata, timestamp: new Date().toISOString() },
  });

  activeClients.forEach((client) => {
    if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}
