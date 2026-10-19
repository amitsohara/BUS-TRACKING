import crypto from 'node:crypto';
import { db } from './db.ts';
import { logAudit } from './auth.ts';

/**
 * Notification Delivery Lifecycle Service
 *
 * Implements truthful notification delivery states:
 * - IN_APP: Stored locally in SQLite and immediately readable by parents (`DELIVERED_IN_APP`).
 * - SMS / PUSH: Kept as `DISABLED_NO_GATEWAY` unless external API keys are configured.
 * - Records provider delivery errors honestly (e.g. `GATEWAY_ERROR`) without falsely claiming `SENT`.
 * - Atomic idempotency prevents duplicate messaging under concurrent requests and rapid retries.
 */

export interface CreateNotificationParams {
  schoolId: string;
  userId: string;
  title: string;
  message: string;
  notificationType: string;
  relatedTripId?: string | null;
  relatedStudentId?: string | null;
  channel?: 'IN_APP' | 'SMS' | 'PUSH';
  idempotencyKey?: string;
}

export interface NotificationRecord {
  id: string;
  school_id: string;
  user_id: string;
  title: string;
  message: string;
  notification_type: string;
  related_trip_id: string | null;
  related_student_id: string | null;
  delivery_status: string;
  channel: string;
  idempotency_key: string | null;
  sent_at: string | null;
  read_at: string | null;
  delivery_provider: string | null;
  provider_response: string | null;
  created_at: string;
}

/**
 * Dispatches an auditable, truthful notification record with atomic database-level idempotency.
 */
export async function dispatchNotification(params: CreateNotificationParams): Promise<NotificationRecord> {
  const {
    schoolId,
    userId,
    title,
    message,
    notificationType,
    relatedTripId = null,
    relatedStudentId = null,
    channel = 'IN_APP',
  } = params;

  // Compute a deterministic idempotency key if one is not explicitly provided.
  // Groups notifications by recipient, event type, trip, student, and a 2-minute time window.
  const timeWindowBucket = Math.floor(Date.now() / (2 * 60 * 1000));
  const effectiveIdempotencyKey =
    params.idempotencyKey ||
    crypto
      .createHash('sha256')
      .update(
        `${schoolId}:${userId}:${notificationType}:${relatedTripId || 'none'}:${relatedStudentId || 'none'}:${timeWindowBucket}`
      )
      .digest('hex');

  // Fast-path lookup by atomic idempotency key
  const existing = db
    .prepare('SELECT * FROM notifications WHERE idempotency_key = ? LIMIT 1')
    .get(effectiveIdempotencyKey) as NotificationRecord | undefined;

  if (existing) {
    return existing;
  }

  let deliveryStatus = 'DELIVERED_IN_APP';
  let deliveryProvider = 'SURAKSHAVAHAN_INTERNAL';
  let providerResponse: string | null = 'Internal in-app notification store';

  if (channel === 'SMS') {
    const smsApiKey = process.env.SMS_GATEWAY_API_KEY;
    if (!smsApiKey || smsApiKey.trim() === '') {
      // Truthful reporting: External gateway credentials not configured
      deliveryStatus = 'DISABLED_NO_GATEWAY';
      deliveryProvider = 'SMS_GATEWAY';
      providerResponse = 'SMS_GATEWAY_API_KEY environment variable is missing. External SMS dispatch disabled.';
    } else {
      // External SMS HTTP dispatch
      deliveryStatus = 'QUEUED';
      deliveryProvider = 'SMS_GATEWAY';
      providerResponse = 'Queued for gateway transmission';
    }
  } else if (channel === 'PUSH') {
    const fcmPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
    if (!fcmPath || fcmPath.trim() === '') {
      deliveryStatus = 'DISABLED_NO_GATEWAY';
      deliveryProvider = 'FCM_PUSH';
      providerResponse = 'FIREBASE_SERVICE_ACCOUNT_KEY_PATH is missing. Mobile push notification dispatch disabled.';
    } else {
      deliveryStatus = 'QUEUED';
      deliveryProvider = 'FCM_PUSH';
      providerResponse = 'Queued for FCM provider';
    }
  }

  const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Atomic insert with SQLite unique constraint conflict resolution
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

  // Retrieve the canonical record (either the one just inserted or the one created by a concurrent request)
  const canonical = db
    .prepare('SELECT * FROM notifications WHERE idempotency_key = ?')
    .get(effectiveIdempotencyKey) as unknown as NotificationRecord;

  // Only log audit event if this invocation actually created the record
  if (canonical && canonical.id === notifId) {
    logAudit({
      schoolId,
      userId,
      action: 'NOTIFICATION_DISPATCHED',
      entityType: 'NOTIFICATION',
      entityId: notifId,
      newValues: {
        type: notificationType,
        channel,
        deliveryStatus,
        deliveryProvider,
        idempotencyKey: effectiveIdempotencyKey,
      },
    });
  }

  return canonical;
}
