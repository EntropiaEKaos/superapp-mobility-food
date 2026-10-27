import pg from 'pg';
import { createClient } from 'redis';

/**
 * Standalone, restartable sandbox outbox relay (not a real ride/payment worker).
 *
 * 1. PostgreSQL statement triggers write rows in the same transaction as the data.
 * 2. Worker claims pending rows using FOR UPDATE SKIP LOCKED.
 * 3. Redis PUBLISH succeeds before rows are marked PUBLISHED.
 *
 * The relay is at-least-once to Redis, not exactly-once or durable delivery to SSE.
 * Duplicate generic notifications are harmless: each SSE packet is a full snapshot.
 */
if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  throw new Error('DATABASE_URL and REDIS_URL required for sandbox event bridge');
}
const channel = 'superapp:sandbox:changed:v1';
const listener = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  application_name: 'superapp-sandbox-redis-bridge',
});
const worker = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  application_name: 'superapp-sandbox-outbox-worker',
});
const redis = createClient({
  url: process.env.REDIS_URL,
  socket: { connectTimeout: 3000, reconnectStrategy: false },
});
let stopping = false;
let draining = false;
let wakeAgain = false;
let timer;
let activeDrain = Promise.resolve();

async function drain() {
  if (stopping) return;
  if (draining) { wakeAgain = true; return; }
  draining = true;
  try {
    do {
      wakeAgain = false;
      if (stopping) return;
      await worker.query('BEGIN');
      try {
        const rows = await worker.query(`
          SELECT "id" FROM "SandboxEventOutbox"
          WHERE "status" = 'PENDING'
          ORDER BY "id"
          LIMIT 25
          FOR UPDATE SKIP LOCKED
        `);
        if (rows.rowCount === 0) {
          await worker.query('COMMIT');
          return;
        }
        const ids = rows.rows.map(row => row.id);
        // Check redis publish acknowledgment before committing the status update.
        // If the bridge crashes afterward, the transaction rolls back and retry
        // may publish a duplicate; clients only receive "changed" + full snapshots.
        await redis.publish(channel, 'changed');
        await worker.query(`
          UPDATE "SandboxEventOutbox"
          SET "status" = 'PUBLISHED',
              "publishedAt" = NOW(),
              "attempts" = "attempts" + 1
          WHERE "id" = ANY($1::bigint[])
        `, [ids]);
        await worker.query('COMMIT');
        wakeAgain = true;
      } catch (error) {
        await worker.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    } while (wakeAgain && !stopping);
  } finally {
    draining = false;
  }
}
function requestDrain() {
  if (stopping) return;
  if (draining) { wakeAgain = true; return; }
  activeDrain = drain().catch(error => {
    console.error('Sandbox outbox drain failed:', error.message);
    void close(1);
  });
}
async function close(code = 0) {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  await activeDrain.catch(() => undefined);
  await Promise.allSettled([
    listener.end(), worker.end(),
    redis.isOpen ? redis.quit() : Promise.resolve(),
  ]);
  process.exitCode = code;
}
redis.on('error', error => {
  console.error('Redis broker error:', error.message);
  void close(1);
});
listener.on('error', error => {
  console.error('PostgreSQL listener error:', error.message);
  void close(1);
});
worker.on('error', error => {
  console.error('PostgreSQL outbox worker error:', error.message);
  void close(1);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { void close(); });
}

try {
  await redis.connect();
  await worker.connect();
  await listener.connect();
  await listener.query('LISTEN superapp_sandbox_changed');
  listener.on('notification', requestDrain);
  // Recovery: even if the bridge misses every NOTIFY during downtime,
  // committed outbox records are scanned on boot and periodically.
  timer = setInterval(requestDrain, 1500);
  console.log('SANDBOX_REDIS_BRIDGE_READY');
  requestDrain();
} catch (error) {
  console.error('Sandbox bridge startup failed:', error);
  await close(1);
}
