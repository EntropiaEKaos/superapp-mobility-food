import pg from 'pg';
import { createClient } from 'redis';

/**
 * Read-only infrastructure preflight for the sandbox Redis broker worker.
 * No environment values, connection strings or credentials are printed.
 */
if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  console.error('PRECHECK_FAIL: DATABASE_URL and REDIS_URL must be configured');
  process.exitCode = 1;
} else {
  const pgClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: 'superapp-sandbox-preflight',
    connectionTimeoutMillis: 3000,
  });
  const redis = createClient({
    url: process.env.REDIS_URL,
    socket: { connectTimeout: 3000, reconnectStrategy: false },
  });
  redis.on('error', () => undefined);
  try {
    await pgClient.connect();
    const inspect = await pgClient.query(`
      SELECT
        to_regclass('"SandboxEventOutbox"') IS NOT NULL AS outbox_ready,
        to_regclass('"SandboxOutboxRequeueAudit"') IS NOT NULL AS audit_ready,
        EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'SandboxRide_stream_change' AND NOT tgisinternal
        ) AS notify_trigger_ready
    `);
    const dbChecks = inspect.rows[0];
    if (!dbChecks.outbox_ready || !dbChecks.audit_ready || !dbChecks.notify_trigger_ready) {
      throw new Error('Required sandbox migrations/triggers are not deployed');
    }
    await redis.connect();
    if (await redis.ping() !== 'PONG') throw new Error('Redis did not respond to PING');
    console.log('PRECHECK_OK ' + JSON.stringify({
      postgres: 'connected',
      outboxTable: true,
      requeueAuditTable: true,
      trigger: true,
      redis: 'reachable',
      mode: process.env.SANDBOX_EVENT_TRANSPORT === 'redis' ? 'redis' : 'postgres',
      sandboxFlag: process.env.ENABLE_SANDBOX_DISPATCH === 'true',
      caveat: 'no production readiness or load SLA implied',
    }));
  } catch (err) {
    console.error('PRECHECK_FAIL:', err instanceof Error ? err.message : 'unknown infrastructure error');
    process.exitCode = 1;
  } finally {
    redis.destroy();
    await pgClient.end().catch(() => undefined);
  }
}
