import { db } from '@superapp/database';
import type { Client } from 'pg';

/** Global, cross-instance limit enforced by PostgreSQL session advisory locks. */
export const SANDBOX_STREAM_CAPACITY = 8;

// Separate advisory lock namespaces avoid collisions with unrelated application locks.
const USER_LOCK_NAMESPACE = 56011001;
const SLOT_LOCK_NAMESPACE = 56011002;

export type StreamAdmission = 'accepted' | 'user_busy' | 'capacity_reached';

/**
 * PostgreSQL advisory session locks are atomic across all app instances.
 * Each admin can hold ONE stream. Eight administrators may stream concurrently.
 * Closing the dedicated Client releases both locks, including on process death.
 */
export async function acquireSandboxStreamSlot(
  client: Client,
  userId: string,
): Promise<StreamAdmission> {
  const userLock = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1::int, hashtext($2::text)) AS acquired',
    [USER_LOCK_NAMESPACE, userId],
  );
  if (!userLock.rows[0]?.acquired) return 'user_busy';
  for (let slot = 0; slot < SANDBOX_STREAM_CAPACITY; slot++) {
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired',
      [SLOT_LOCK_NAMESPACE, slot],
    );
    if (lock.rows[0]?.acquired) return 'accepted';
  }
  return 'capacity_reached';
}

/**
 * A read-only, privacy-safe view of active SSE sessions.
 * Counts this database's PostgreSQL connections, not web requests or users.
 */
export async function getSandboxStreamHealth() {
  const rows = await db().$queryRaw<Array<{ activeConnections: number }>>`
    SELECT COUNT(*)::int AS "activeConnections"
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND application_name = 'superapp-sandbox-sse'
  `;
  const activeConnections = rows[0]?.activeConnections ?? 0;
  return {
    activeConnections,
    capacity: SANDBOX_STREAM_CAPACITY,
    availableSlots: Math.max(0, SANDBOX_STREAM_CAPACITY - activeConnections),
    utilizationPercent: Math.round(activeConnections / SANDBOX_STREAM_CAPACITY * 100),
  };
}
