import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

const port = 3190;
const origin = 'http://localhost:' + port;
const token = 'ci-monitor-token-only-0123456789-abcd-ABCD';
const mode = process.env.SANDBOX_EVENT_TRANSPORT === 'redis' ? 'redis' : 'postgres';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const children = [];
let output = '';
const alerts = [];
const webhook = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  alerts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  res.writeHead(204).end();
});
async function waitFor(check, label, maxMs = 15_000) {
  const until = Date.now() + maxMs;
  do {
    if (await check()) return;
    await sleep(125);
  } while (Date.now() < until);
  throw new Error('Timed out: ' + label + ' ' + output.slice(-1300));
}
function start(command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.stdout.on('data', bytes => { output += String(bytes); });
  child.stderr.on('data', bytes => { output += String(bytes); });
  return child;
}
function stop(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch { /* stopped */ }
}
async function probe(secret = token) {
  return fetch(origin + '/api/ops/sandbox-health', {
    headers: { Authorization: 'Bearer ' + secret },
    signal: AbortSignal.timeout(5000),
  });
}
async function runCli(webhookUrl) {
  const child = start('node', ['scripts/sandbox-monitor-check.mjs'], {
    SANDBOX_MONITOR_URL: origin + '/api/ops/sandbox-health',
    SANDBOX_MONITOR_TOKEN: token,
    SANDBOX_ALERT_WEBHOOK_URL: webhookUrl,
  });
  let lines = '';
  child.stdout.on('data', bytes => { lines += String(bytes); });
  child.stderr.on('data', bytes => { lines += String(bytes); });
  await waitFor(() => child.exitCode !== null, 'monitor CLI exit');
  return { exit: child.exitCode, lines };
}

let app;
let bridge;
try {
  await new Promise(resolve => webhook.listen(0, '127.0.0.1', resolve));
  const alertUrl = 'http://127.0.0.1:' + webhook.address().port + '/alert';
  app = start('npm', ['run', 'start', '-w', '@superapp/web', '--', '-p', String(port)], {
    ENABLE_SANDBOX_DISPATCH: 'true',
    SANDBOX_MONITOR_TOKEN: token,
    BETTER_AUTH_URL: origin,
    NEXT_PUBLIC_APP_URL: origin,
  });
  await waitFor(async () => {
    try { return (await fetch(origin + '/api/health')).ok; } catch { return false; }
  }, 'Next.js monitor web');

  const unknown = await fetch(origin + '/api/ops/sandbox-health');
  assert.equal(unknown.status, 401);
  assert.match(unknown.headers.get('cache-control') ?? '', /no-store/);
  assert.equal((await probe('invalid-token')).status, 401);
  if (mode === 'redis') {
    const offline = await probe();
    assert.equal(offline.status, 503);
    assert.ok((await offline.json()).reasons.includes('WORKER_MISSING'));
    bridge = start('node', ['scripts/sandbox-redis-bridge.mjs']);
    await waitFor(() => output.includes('SANDBOX_REDIS_BRIDGE_READY'), 'Redis worker');
  }

  await waitFor(async () => {
    try { return (await probe()).status === 200; } catch { return false; }
  }, 'healthy monitor readiness');
  const healthy = await probe();
  const healthyJson = await healthy.json();
  assert.deepEqual(healthyJson.reasons, []);
  assert.equal(healthyJson.status, 'healthy');
  assert.equal(healthyJson.transport, mode);

  const goodCli = await runCli(alertUrl);
  assert.equal(goodCli.exit, 0, goodCli.lines);
  assert.equal(alerts.length, 0, 'do not alert while healthy');

  const fixture = await db.query(`
    INSERT INTO "SandboxEventOutbox" ("sourceTable", "operation", "status", "attempts", "lastErrorCode")
    VALUES ('health-ci', 'UPDATE', 'DEAD', 5, 'CI_ONLY')
    RETURNING "id"
  `);
  const id = fixture.rows[0].id;
  try {
    const failed = await probe();
    assert.equal(failed.status, 503);
    const failedBody = await failed.json();
    assert.ok(failedBody.reasons.includes('OUTBOX_DEAD'));
    const badCli = await runCli(alertUrl);
    assert.equal(badCli.exit, 1, badCli.lines);
    await waitFor(() => alerts.length >= 1, 'sanitized alert webhook');
    assert.ok(alerts[0].codes.includes('OUTBOX_DEAD'));
    assert.ok(!JSON.stringify(alerts[0]).includes(token), 'alert must not include monitoring credentials');
    assert.ok(!badCli.lines.includes(token), 'log must not include credentials');
  } finally {
    await db.query('DELETE FROM "SandboxEventOutbox" WHERE "id"=$1', [id]);
  }

  const stale = await db.query(`
    INSERT INTO "SandboxEventOutbox"
      ("sourceTable", "operation", "status", "createdAt", "nextAttemptAt")
    VALUES ('health-ci', 'UPDATE', 'PENDING',
      NOW() - INTERVAL '60 seconds', NOW() + INTERVAL '1 hour')
    RETURNING "id"
  `);
  try {
    const degraded = await probe();
    assert.equal(degraded.status, 503);
    assert.ok((await degraded.json()).reasons.includes('OUTBOX_DELAYED'));
  } finally {
    await db.query('DELETE FROM "SandboxEventOutbox" WHERE "id"=$1', [stale.rows[0].id]);
  }
  assert.equal((await probe()).status, 200);
  console.log('PASS: protected monitor, healthy/degraded, stale/dead alerts, sanitized webhook, mode=' + mode);
} catch (err) {
  console.error(err, output.slice(-2500));
  process.exitCode = 1;
} finally {
  stop(app);
  stop(bridge);
  await db.end();
  await new Promise(resolve => webhook.close(resolve));
}
