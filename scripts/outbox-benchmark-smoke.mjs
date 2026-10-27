import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

// Bounded CI load: synthetic table only, no passengers/drivers, orders or payments.
if (process.env.CI !== 'true') throw new Error('Synthetic benchmark is CI-only.');
const TOTAL = 240;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
const workers = [];
let logs = '';

async function waitFor(predicate, label, maximumMs = 30_000) {
  const deadline = Date.now() + maximumMs;
  do {
    if (await predicate()) return;
    await sleep(150);
  } while (Date.now() < deadline);
  throw new Error('Timeout: ' + label + ' ' + logs.slice(-1000));
}
async function startWorker() {
  const child = spawn(process.execPath, ['scripts/sandbox-redis-bridge.mjs'], {
    env: { ...process.env, SANDBOX_CI_PUBLISH_FAILURES: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  workers.push(child);
  let ready = false;
  child.stdout.on('data', bytes => {
    logs += String(bytes);
    if (String(bytes).includes('SANDBOX_REDIS_BRIDGE_READY')) ready = true;
  });
  child.stderr.on('data', bytes => { logs += String(bytes); });
  await waitFor(() => ready || child.exitCode !== null, 'bridge startup');
  assert.equal(child.exitCode, null, 'bridge failed to start');
}
function percentile(sorted, fraction) {
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
try {
  const baseline = (await pool.query(
    'SELECT COALESCE(MAX("id"), 0)::text AS id FROM "SandboxEventOutbox"'
  )).rows[0].id;
  const started = performance.now();
  await Promise.all(Array.from({ length: TOTAL }, async (_, i) => {
    const id = 'stress16-' + process.pid + '-' + i;
    await pool.query(
      'INSERT INTO "SandboxDriver" ("id", "label", "lat", "lng", "lastSeenAt") VALUES ($1,$2,$3,$4,NOW())',
      [id, id, -24.005, -46.415],
    );
  }));
  const ingestionMs = performance.now() - started;
  const initial = await pool.query(`
    SELECT COUNT(*)::int AS count FROM "SandboxEventOutbox"
    WHERE "id" > $1::bigint AND "status" = 'PENDING'
  `, [baseline]);
  assert.equal(initial.rows[0].count, TOTAL, 'one outbox record per committed synthetic INSERT');

  const drainStarted = performance.now();
  await Promise.all(Array.from({ length: 4 }, () => startWorker()));
  await waitFor(async () => {
    const records = await pool.query(`
      SELECT COUNT(*)::int AS pending FROM "SandboxEventOutbox"
      WHERE "id" > $1::bigint AND "status" = 'PENDING'
    `, [baseline]);
    return records.rows[0].pending === 0;
  }, '240 pending entries published');
  const drainMs = performance.now() - drainStarted;
  const records = await pool.query(`
    SELECT "status", "attempts",
      EXTRACT(EPOCH FROM ("publishedAt" - "createdAt")) * 1000 AS lag_ms
    FROM "SandboxEventOutbox" WHERE "id" > $1::bigint
  `, [baseline]);
  assert.equal(records.rowCount, TOTAL);
  assert.ok(records.rows.every(row => row.status === 'PUBLISHED' && row.attempts === 1),
    'all synthetic events should publish exactly once without retry');
  const lags = records.rows.map(row => Number(row.lag_ms)).sort((a, b) => a - b);
  assert.ok(lags.every(value => Number.isFinite(value) && value >= 0));
  const p50 = percentile(lags, 0.5);
  const p95 = percentile(lags, 0.95);
  // Generous CI regression guard, not a commercial SLA.
  assert.ok(p95 < 30_000, 'p95 synthetic event latency exceeded 30s test ceiling');
  assert.ok(drainMs < 30_000);
  const totalRides = await pool.query('SELECT COUNT(*)::int AS total FROM "Ride"');
  assert.equal(totalRides.rows[0].total, 0, 'commercial ride records untouched');
  console.log('PASS: ' + JSON.stringify({
    syntheticEvents: TOTAL, workers: 4,
    ingressMs: Math.round(ingestionMs), drainMs: Math.round(drainMs),
    p50LatencyMs: Math.round(p50), p95LatencyMs: Math.round(p95),
    throughputEventsPerSec: Number((TOTAL / Math.max(drainMs / 1000, 0.001)).toFixed(1)),
    published: records.rowCount, duplicates: 0,
    caveat: 'ephemeral GitHub CI; not production throughput',
  }));
} catch (error) {
  console.error(error);
  console.error('Workers:', logs.slice(-2000));
  process.exitCode = 1;
} finally {
  for (const child of workers) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await pool.end();
}
