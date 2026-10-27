import pg from 'pg';
import { createClient } from 'redis';

/**
 * Run this as a SEPARATE long-lived worker, not in a web request.
 * Exactly one bridge instance per sandbox deployment (no leader election yet).
 * On PostgreSQL commit, forwards generic changed signals to Redis Pub/Sub.
 */
if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  throw new Error('DATABASE_URL and REDIS_URL required for sandbox event bridge');
}
const channel = 'superapp:sandbox:changed:v1';
const postgres = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  application_name: 'superapp-sandbox-redis-bridge',
});
const redis = createClient({
  url: process.env.REDIS_URL,
  socket: { connectTimeout: 3000, reconnectStrategy: false },
});
let stopping = false;
let sent = Promise.resolve();

async function close(code = 0) {
  if (stopping) return;
  stopping = true;
  await sent.catch(() => undefined);
  await Promise.allSettled([postgres.end(), redis.isOpen ? redis.quit() : Promise.resolve()]);
  process.exitCode = code;
}
redis.on('error', error => {
  console.error('Redis broker error:', error.message);
  void close(1);
});
postgres.on('error', error => {
  console.error('PostgreSQL listener error:', error.message);
  void close(1);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { void close(); });
}
try {
  await redis.connect();
  await postgres.connect();
  await postgres.query('LISTEN superapp_sandbox_changed');
  postgres.on('notification', () => {
    if (stopping) return;
    sent = sent.then(() => redis.publish(channel, 'changed'))
      .then(() => undefined)
      .catch(error => {
        console.error('Broker publish error:', error.message);
        void close(1);
      });
  });
  console.log('SANDBOX_REDIS_BRIDGE_READY');
} catch (error) {
  console.error('Sandbox bridge startup failed:', error);
  await close(1);
}
