import pg from 'pg';
import { createClient } from 'redis';

/**
 * Sandbox-only PostgreSQL outbox → Redis relay.
 * At-least-once signals: duplicates are safe because SSE refreshes snapshots.
 */
if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  throw new Error('DATABASE_URL and REDIS_URL required for sandbox event bridge');
}
const channel = 'superapp:sandbox:changed:v1';
const MAX_ATTEMPTS = 5;
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
// CI-only controlled fault injection, never enabled in deployed environments.
let testFailures = process.env.CI === 'true'
  ? Math.max(0, Math.min(10, Number.parseInt(process.env.SANDBOX_CI_PUBLISH_FAILURES ?? '0', 10) || 0))
  : 0;

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
          WHERE "status" = 'PENDING' AND "nextAttemptAt" <= NOW()
          ORDER BY "id"
          LIMIT 25
          FOR UPDATE SKIP LOCKED
        `);
        if (rows.rowCount === 0) {
          await worker.query('COMMIT');
          return;
        }
        const ids = rows.rows.map(row => row.id);
        let failed = false;
        try {
          if (testFailures > 0) {
            testFailures -= 1;
            throw new Error('CI injected publish failure');
          }
          await redis.publish(channel, 'changed');
        } catch {
          failed = true;
        }
        if (failed) {
          // Keep failed attempts recorded even after a worker restart. No raw
          // exception text is persisted (it might include connection secrets).
          await worker.query(`
            UPDATE "SandboxEventOutbox"
            SET "attempts" = "attempts" + 1,
                "status" = CASE WHEN "attempts" + 1 >= $2
                  THEN 'DEAD'::"SandboxOutboxStatus"
                  ELSE 'PENDING'::"SandboxOutboxStatus" END,
                "nextAttemptAt" = NOW() + LEAST(60, POWER(2, LEAST("attempts" + 1, 6))::int) * INTERVAL '1 second',
                "lastErrorCode" = 'REDIS_PUBLISH_FAILED'
            WHERE "id" = ANY($1::bigint[])
          `, [ids, MAX_ATTEMPTS]);
        } else {
          await worker.query(`
            UPDATE "SandboxEventOutbox"
            SET "status" = 'PUBLISHED',
                "publishedAt" = NOW(),
                "attempts" = "attempts" + 1,
                "lastErrorCode" = NULL
            WHERE "id" = ANY($1::bigint[])
          `, [ids]);
        }
        await worker.query('COMMIT');
        // Any due rows left are retried; deferred rows wait for the next scan.
        wakeAgain = !failed;
        if (failed && !redis.isReady) {
          console.error('Redis connection unavailable; relay requires supervisor restart.');
          setImmediate(() => { void close(1); });
        }
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
    console.error('Sandbox outbox SQL operation failed:', error.message);
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
  console.error('Redis broker disconnected:', error.message);
  void close(1);
});
listener.on('error', error => {
  console.error('PostgreSQL listener disconnected:', error.message);
  void close(1);
});
worker.on('error', error => {
  console.error('PostgreSQL outbox worker disconnected:', error.message);
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
  timer = setInterval(requestDrain, 1500);
  console.log('SANDBOX_REDIS_BRIDGE_READY');
  requestDrain();
} catch (error) {
  console.error('Sandbox bridge startup failed:', error.message);
  await close(1);
}
