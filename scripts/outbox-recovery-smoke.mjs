import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { createClient } from 'redis';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const subscriber = createClient({
  url: process.env.REDIS_URL, socket: { reconnectStrategy: false },
});
subscriber.on('error', () => undefined);
const channel = 'superapp:sandbox:changed:v1';
const driverId = 'outbox-ci-' + process.pid;
const workers = [];
let signals = 0;
let diagnostics = '';

async function waitFor(check, label) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await sleep(120);
  }
  throw new Error('Timed out: ' + label + ' ' + diagnostics.slice(-800));
}
async function pendingCount() {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM "SandboxEventOutbox" WHERE "status" = $1', ['PENDING']);
  return r.rows[0].n;
}
async function allCount() {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM "SandboxEventOutbox"');
  return r.rows[0].n;
}
async function startWorker() {
  const proc = spawn(process.execPath, ['scripts/sandbox-redis-bridge.mjs'], {
    env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  workers.push(proc);
  let ready = false;
  proc.stdout.on('data', bytes => {
    const text = String(bytes);
    diagnostics += text;
    if (text.includes('SANDBOX_REDIS_BRIDGE_READY')) ready = true;
  });
  proc.stderr.on('data', bytes => { diagnostics += String(bytes); });
  await waitFor(() => ready || proc.exitCode !== null, 'worker boot');
  assert.equal(proc.exitCode, null, diagnostics.slice(-1200));
  return proc;
}
async function stopWorker(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  await waitFor(() => proc.exitCode !== null || proc.signalCode !== null, 'worker stop');
}
try {
  assert.ok(process.env.DATABASE_URL && process.env.REDIS_URL);
  await subscriber.connect();
  await subscriber.subscribe(channel, () => { signals += 1; });

  // A committed sandbox change writes a matching, durable pending event.
  const before = await allCount();
  await pool.query(
    'INSERT INTO "SandboxDriver" ("id","label","lat","lng","lastSeenAt") VALUES ($1,$2,$3,$4,NOW())',
    [driverId, 'CI outbox-only vehicle', -24.005, -46.415],
  );
  assert.equal(await allCount(), before + 1);
  assert.ok(await pendingCount() >= 1);

  // A rolled-back write cannot leak an outbox event into the ledger.
  const trx = await pool.connect();
  try {
    await trx.query('BEGIN');
    await trx.query('UPDATE "SandboxDriver" SET "busy" = true WHERE "id"=$1', [driverId]);
    await trx.query('ROLLBACK');
  } finally {
    trx.release();
  }
  assert.equal(await allCount(), before + 1, 'outbox is atomic with sandbox mutation');

  const first = await startWorker();
  await waitFor(async () => (await pendingCount()) === 0, 'initial drain');
  await waitFor(() => signals >= 1, 'published Redis event');
  await stopWorker(first);

  // Worker absence preserves new events until another process starts.
  const publishedBefore = await pool.query('SELECT COUNT(*)::int AS n FROM "SandboxEventOutbox" WHERE "status"=$1', ['PUBLISHED']);
  await pool.query('UPDATE "SandboxDriver" SET "busy"=true WHERE "id"=$1', [driverId]);
  assert.equal(await pendingCount(), 1, 'notice survives worker downtime');

  const second = await startWorker();
  await waitFor(async () => (await pendingCount()) === 0, 'recovery drain');
  await waitFor(() => signals >= 2, 'recovered change republished');
  const publishedAfter = await pool.query('SELECT COUNT(*)::int AS n FROM "SandboxEventOutbox" WHERE "status"=$1', ['PUBLISHED']);
  assert.equal(publishedAfter.rows[0].n, publishedBefore.rows[0].n + 1);

  const realRides = await pool.query('SELECT COUNT(*)::int AS n FROM "Ride"');
  assert.equal(realRides.rows[0].n, 0, 'outbox test never touches commercial rides');
  console.log('PASS: transactional outbox, rollback, worker interruption and Redis recovery');
} catch (error) {
  console.error(error);
  console.error(diagnostics.slice(-2200));
  process.exitCode = 1;
} finally {
  for (const proc of workers) {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
  }
  await subscriber.unsubscribe(channel).catch(() => undefined);
  subscriber.destroy();
  await pool.end();
}
