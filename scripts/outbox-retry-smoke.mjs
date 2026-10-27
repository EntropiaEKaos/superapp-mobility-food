import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { createClient } from 'redis';

if (process.env.CI !== 'true') throw new Error('This fault injection test is CI-only.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const subscriber = createClient({
  url: process.env.REDIS_URL, socket: { reconnectStrategy: false },
});
subscriber.on('error', () => undefined);
const workers = [];
let received = 0;
let logs = '';

async function waitFor(test, label, max = 120) {
  for (let i = 0; i < max; i++) {
    if (await test()) return;
    await sleep(100);
  }
  throw new Error('Timeout: ' + label + '\n' + logs.slice(-1000));
}
async function startWorker(failures = 0) {
  const child = spawn(process.execPath, ['scripts/sandbox-redis-bridge.mjs'], {
    env: { ...process.env, SANDBOX_CI_PUBLISH_FAILURES: String(failures) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  workers.push(child);
  let ready = false;
  child.stdout.on('data', data => {
    const message = String(data);
    logs += message;
    if (message.includes('SANDBOX_REDIS_BRIDGE_READY')) ready = true;
  });
  child.stderr.on('data', data => { logs += String(data); });
  await waitFor(() => ready || child.exitCode !== null, 'worker start');
  assert.equal(child.exitCode, null, logs.slice(-800));
  return child;
}
async function stopWorker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'worker close');
}
async function lastOutbox() {
  return (await pool.query('SELECT * FROM "SandboxEventOutbox" ORDER BY "id" DESC LIMIT 1')).rows[0];
}
async function writeDriver(id) {
  await pool.query(
    'INSERT INTO "SandboxDriver"("id", "label", "lat", "lng", "lastSeenAt") VALUES ($1, $2, $3, $4, NOW())',
    [id, id, -24.005, -46.415],
  );
  return (await lastOutbox()).id;
}
function runPrune(args) {
  return JSON.parse(execFileSync(process.execPath, ['scripts/sandbox-outbox-prune.mjs', ...args], {
    encoding: 'utf8', env: process.env,
  }).trim());
}

try {
  await subscriber.connect();
  await subscriber.subscribe('superapp:sandbox:changed:v1', () => { received += 1; });

  // A transient Redis failure is recorded with backoff, then succeeds.
  const retryId = await writeDriver('retry-ci-' + process.pid);
  const retryWorker = await startWorker(1);
  await waitFor(async () => {
    const row = (await pool.query('SELECT "attempts", "status", "lastErrorCode" FROM "SandboxEventOutbox" WHERE "id"=$1', [retryId])).rows[0];
    return row.attempts === 1 && row.status === 'PENDING' && row.lastErrorCode === 'REDIS_PUBLISH_FAILED';
  }, 'record transient retry');
  await waitFor(async () => {
    const row = (await pool.query('SELECT "attempts", "status", "lastErrorCode" FROM "SandboxEventOutbox" WHERE "id"=$1', [retryId])).rows[0];
    return row.status === 'PUBLISHED' && row.attempts === 2 && row.lastErrorCode === null;
  }, 'retry eventually published');
  await waitFor(() => received >= 1, 'redis subscriber receives retried event');
  await stopWorker(retryWorker);

  // Deliberately start a record on its final permitted attempt.
  const deadId = await writeDriver('dead-ci-' + process.pid);
  await pool.query('UPDATE "SandboxEventOutbox" SET "attempts"=4 WHERE "id"=$1', [deadId]);
  const deadWorker = await startWorker(1);
  await waitFor(async () => {
    const row = (await pool.query('SELECT "status", "attempts" FROM "SandboxEventOutbox" WHERE "id"=$1', [deadId])).rows[0];
    return row.status === 'DEAD' && row.attempts === 5;
  }, 'dead letter after bounded retry');
  await stopWorker(deadWorker);

  // Dry-run by default. Explicit prune removes only old published notices.
  const historic = await pool.query(`
    INSERT INTO "SandboxEventOutbox"
      ("status", "sourceTable", "operation", "createdAt", "publishedAt")
    VALUES ('PUBLISHED', 'test', 'UPDATE', NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days')
    RETURNING "id"
  `);
  const historicId = historic.rows[0].id;
  const dry = runPrune(['--days=7']);
  assert.equal(dry.mode, 'dry-run');
  assert.ok(dry.eligible >= 1);
  assert.equal(dry.deleted, 0);
  const preserved = await pool.query('SELECT COUNT(*)::int AS n FROM "SandboxEventOutbox" WHERE "id"=$1', [historicId]);
  assert.equal(preserved.rows[0].n, 1);
  const applied = runPrune(['--apply', '--days=7']);
  assert.equal(applied.mode, 'apply');
  assert.ok(applied.deleted >= 1);
  const afterPrune = await pool.query('SELECT COUNT(*)::int AS n FROM "SandboxEventOutbox" WHERE "id"=$1', [historicId]);
  assert.equal(afterPrune.rows[0].n, 0);
  const stillDead = await pool.query('SELECT "status" FROM "SandboxEventOutbox" WHERE "id"=$1', [deadId]);
  assert.equal(stillDead.rows[0].status, 'DEAD');

  // Small bounded load: multiple workers process a backlog without repeated
  // claims; statement triggers create one notification per committed UPDATE.
  const loadId = 'load-ci-' + process.pid;
  await writeDriver(loadId);
  const firstLoadWorker = await startWorker();
  const secondLoadWorker = await startWorker();
  for (let i = 0; i < 60; i++) {
    await pool.query('UPDATE "SandboxDriver" SET "lastSeenAt"=NOW() WHERE "id"=$1', [loadId]);
  }
  await waitFor(async () => {
    const rows = await pool.query('SELECT COUNT(*)::int AS n FROM "SandboxEventOutbox" WHERE "status"=$1', ['PENDING']);
    return rows.rows[0].n === 0;
  }, 'sixty event backlog drained by two workers', 150);
  const overpublished = await pool.query(
    'SELECT COUNT(*)::int AS n FROM "SandboxEventOutbox" WHERE "status"=$1 AND "attempts" > 1',
    ['PUBLISHED'],
  );
  assert.equal(overpublished.rows[0].n, 1, 'only injected transient retry may be published after multiple attempts');
  await stopWorker(firstLoadWorker);
  await stopWorker(secondLoadWorker);

  console.log('PASS: bounded backoff, dead letters, safe retention and 60-write concurrent-worker load.');
} catch (error) {
  console.error(error);
  console.error(logs.slice(-1200));
  process.exitCode = 1;
} finally {
  for (const child of workers) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await subscriber.unsubscribe('superapp:sandbox:changed:v1').catch(() => undefined);
  subscriber.destroy();
  await pool.end();
}
