import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { MAX_CONSECUTIVE_PUBLISH_FAILURES, nextBrokerCircuit } from './lib/sandbox-broker-circuit.mjs';

if (process.env.CI !== 'true') throw new Error('Fault injection requires ephemeral CI.');
assert.deepEqual(nextBrokerCircuit(0, false), { consecutiveFailures: 1, open: false });
assert.deepEqual(nextBrokerCircuit(2, false), { consecutiveFailures: 3, open: true });
assert.deepEqual(nextBrokerCircuit(2, true), { consecutiveFailures: 0, open: false });
assert.equal(MAX_CONSECUTIVE_PUBLISH_FAILURES, 3);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const children = [];
let logs = '';

async function waitFor(check, label, timeoutMs = 24_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await check()) return;
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error('Timeout ' + label + ': ' + logs.slice(-1500));
}
async function startWorker(failures) {
  const child = spawn(process.execPath, ['scripts/sandbox-redis-bridge.mjs'], {
    env: { ...process.env, SANDBOX_CI_PUBLISH_FAILURES: String(failures) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', data => { logs += String(data); });
  child.stderr.on('data', data => { logs += String(data); });
  await waitFor(() => logs.includes('SANDBOX_REDIS_BRIDGE_READY') || child.exitCode !== null,
    'worker boot');
  assert.equal(child.exitCode, null);
  return child;
}
try {
  const driver = 'circuit16-' + process.pid;
  const created = await pool.query(`
    INSERT INTO "SandboxDriver"("id", "label", "lat", "lng", "lastSeenAt")
    VALUES ($1,$2,-24.005,-46.415,NOW())
  `, [driver, driver]);
  assert.equal(created.rowCount, 1);
  const id = (await pool.query(
    'SELECT MAX("id")::text AS id FROM "SandboxEventOutbox"'
  )).rows[0].id;
  const broken = await startWorker(3);
  await waitFor(() => broken.exitCode !== null, 'circuit opens after 3 failed publications');
  assert.equal(broken.exitCode, 1);
  assert.match(logs, /SANDBOX_BROKER_CIRCUIT_OPEN/);
  const pending = await pool.query(
    'SELECT "status", "attempts", "lastErrorCode" FROM "SandboxEventOutbox" WHERE "id"=$1',
    [id],
  );
  assert.equal(pending.rows[0].status, 'PENDING', 'circuit must not discard pending notifications');
  assert.equal(pending.rows[0].attempts, 3);
  assert.equal(pending.rows[0].lastErrorCode, 'REDIS_PUBLISH_FAILED');

  // A clean restarted worker respects nextAttemptAt and finishes the pending event.
  const recovery = await startWorker(0);
  await waitFor(async () => {
    const row = await pool.query(
      'SELECT "status", "attempts" FROM "SandboxEventOutbox" WHERE "id"=$1', [id]
    );
    return row.rows[0].status === 'PUBLISHED' && row.rows[0].attempts === 4;
  }, 'circuit recovery after persisted backoff', 25_000);
  recovery.kill('SIGTERM');
  console.log('PASS: three-failure circuit, worker exits, outbox survives, delayed recovery publishes');
} catch (error) {
  console.error(error);
  console.error(logs.slice(-2500));
  process.exitCode = 1;
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await pool.end();
}
