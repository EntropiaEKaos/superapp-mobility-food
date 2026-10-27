import { db } from '@superapp/database';
import { makeRedisClient } from './sandbox-redis-transport';

export const MONITOR_MAX_PENDING_AGE_SECONDS = 15;
type MonitorInput = {
  pending: number;
  dead: number;
  oldestPendingAgeSeconds: number | null;
  workerConnections: number;
  transport: 'postgres' | 'redis';
  redisReachable: boolean;
};
export type MonitorCode =
  'OUTBOX_DELAYED' | 'OUTBOX_DEAD' | 'WORKER_MISSING' | 'REDIS_UNREACHABLE';

export function monitorReasons(input: MonitorInput): MonitorCode[] {
  const reasons: MonitorCode[] = [];
  if (input.oldestPendingAgeSeconds !== null &&
      input.oldestPendingAgeSeconds > MONITOR_MAX_PENDING_AGE_SECONDS) {
    reasons.push('OUTBOX_DELAYED');
  }
  if (input.dead > 0) reasons.push('OUTBOX_DEAD');
  if (input.transport === 'redis') {
    if (!input.redisReachable) reasons.push('REDIS_UNREACHABLE');
    if (input.workerConnections < 1) reasons.push('WORKER_MISSING');
  }
  return reasons;
}

/** Small bounded query, avoiding any riders, coordinates, user IDs or tokens. */
async function readOutboxReadiness() {
  const rows = await db().$queryRaw<Array<{
    pending: number;
    dead: number;
    oldestSeconds: number | null;
    workerConnections: number;
  }>>`
    SELECT
      (SELECT COUNT(*)::int FROM "SandboxEventOutbox"
       WHERE "status" = 'PENDING') AS pending,
      (SELECT COUNT(*)::int FROM "SandboxEventOutbox"
       WHERE "status" = 'DEAD') AS dead,
      (SELECT EXTRACT(EPOCH FROM NOW() - MIN("createdAt"))::float8
       FROM "SandboxEventOutbox" WHERE "status" = 'PENDING') AS "oldestSeconds",
      (SELECT COUNT(*)::int FROM pg_stat_activity
       WHERE datname = current_database()
         AND application_name = 'superapp-sandbox-outbox-worker') AS "workerConnections"
  `;
  if (!rows.length) throw new Error('database_missing');
  return rows[0];
}
async function redisAvailable(): Promise<boolean> {
  const client = makeRedisClient();
  try {
    await client.connect();
    return await client.ping() === 'PONG';
  } catch {
    return false;
  } finally {
    client.destroy();
  }
}

export async function sandboxReadiness() {
  const transport = process.env.SANDBOX_EVENT_TRANSPORT === 'redis'
    ? 'redis' as const : 'postgres' as const;
  const row = await readOutboxReadiness();
  const reachable = transport === 'redis' ? await redisAvailable() : true;
  const oldestPendingAgeSeconds = row.oldestSeconds === null
    ? null : Math.max(0, Math.floor(row.oldestSeconds));
  const conditions: MonitorInput = {
    transport, pending: row.pending, dead: row.dead,
    oldestPendingAgeSeconds, workerConnections: row.workerConnections,
    redisReachable: reachable,
  };
  const reasons = monitorReasons(conditions);
  return {
    service: 'superapp-sandbox-monitor',
    status: reasons.length ? 'unhealthy' as const : 'healthy' as const,
    transport, reasons,
    metrics: {
      pending: row.pending,
      dead: row.dead,
      oldestPendingAgeSeconds,
      workerConnections: row.workerConnections,
      redisReachable: reachable,
    },
    evaluatedAt: new Date().toISOString(),
  };
}
