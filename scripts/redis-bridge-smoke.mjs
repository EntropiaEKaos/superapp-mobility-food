import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from 'redis';
import pg from 'pg';

const port = 3189;
const origin = 'http://localhost:' + port;
const email = 'redis-ci-' + process.pid + '@example.invalid';
const password = 'Only-For-CI-Password-9321!';
const channel = 'superapp:sandbox:changed:v1';
const prefix = 'superapp:sandbox:stream:v1:slot:';
const processes = [];
let logs = '';
function start(command, args, opts = {}) {
  const p = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    ...opts,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  processes.push(p);
  for (const stream of [p.stdout, p.stderr]) {
    stream.on('data', data => { logs += String(data); });
  }
  return p;
}
async function waitFor(predicate, label, max = 80) {
  for (let attempt = 0; attempt < max; attempt++) {
    if (await predicate()) return;
    await sleep(150);
  }
  throw new Error('Timed out: ' + label);
}
function stop(p) {
  if (!p?.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-p.pid, 'SIGTERM');
    else p.kill('SIGTERM');
  } catch { /* already exited */ }
}
function api(path, opts = {}) {
  return fetch(origin + path, { signal: AbortSignal.timeout(7000), ...opts });
}
async function readSSE(reader, frameBuffer) {
  const decoder = new TextDecoder();
  for (let tries = 0; tries < 30; tries++) {
    let at = frameBuffer.text.indexOf('\n\n');
    while (at !== -1) {
      const frame = frameBuffer.text.slice(0, at);
      frameBuffer.text = frameBuffer.text.slice(at + 2);
      if (frame.includes('event: snapshot')) {
        const row = frame.split('\n').find(line => line.startsWith('data: '));
        assert.ok(row);
        return JSON.parse(row.slice(6));
      }
      at = frameBuffer.text.indexOf('\n\n');
    }
    const chunk = await Promise.race([
      reader.read(),
      sleep(7000, undefined, { ref: false }).then(() => { throw new Error('SSE timeout'); }),
    ]);
    assert.equal(chunk.done, false, 'stream closed prematurely');
    frameBuffer.text += decoder.decode(chunk.value, { stream: true });
  }
  throw new Error('No SSE snapshot observed');
}

const redis = createClient({ url: process.env.REDIS_URL, socket: { reconnectStrategy: false } });
redis.on('error', () => undefined);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let server;
let bridge;
try {
  assert.ok(process.env.REDIS_URL);
  assert.ok(process.env.DATABASE_URL);
  await redis.connect();
  await redis.flushDb();
  bridge = start('node', ['scripts/sandbox-redis-bridge.mjs']);
  await waitFor(() => logs.includes('SANDBOX_REDIS_BRIDGE_READY'), 'bridge ready');

  server = start('npm', ['run', 'start', '-w', '@superapp/web', '--', '-p', String(port)], {
    env: {
      BETTER_AUTH_URL: origin, NEXT_PUBLIC_APP_URL: origin,
      ENABLE_SANDBOX_DISPATCH: 'true',
      SANDBOX_EVENT_TRANSPORT: 'redis',
    },
  });
  await waitFor(async () => {
    try { return (await api('/api/health')).ok; } catch { return false; }
  }, 'Next.js server');

  assert.equal((await api('/api/admin/sandbox-rides/stream')).status, 401);
  const signup = await api('/api/auth/sign-up/email', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Redis Test Admin', email, password }),
  });
  assert.equal(signup.status, 200, 'user sign-up in isolated CI');
  const cookies = signup.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  assert.ok(cookies);
  assert.equal((await api('/api/admin/sandbox-rides/stream', { headers: { Cookie: cookies } })).status, 403);
  await pool.query('UPDATE "users" SET "role" = $1 WHERE "email" = $2', ['ADMIN', email]);

  async function stream() {
    const controller = new AbortController();
    const res = await api('/api/admin/sandbox-rides/stream', {
      headers: { Cookie: cookies }, signal: controller.signal,
    });
    if (res.status !== 200) return { res, controller };
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = res.body.getReader();
    return { res, controller, reader, buf: { text: '' } };
  }
  const first = await stream();
  assert.equal(first.res.status, 200);
  const initial = await readSSE(first.reader, first.buf);
  assert.equal(initial.demo, true);
  assert.equal(initial.metrics.totalRides, 0);
  assert.equal(initial.streamHealth.transport, 'redis');
  assert.equal(initial.streamHealth.capacity, 16);

  const duplicate = await stream();
  assert.equal(duplicate.res.status, 429);
  assert.equal((await duplicate.res.json()).code, 'user_busy');

  const created = await api('/api/admin/sandbox-rides', {
    method: 'POST', headers: { Cookie: cookies, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', origin: 'boqueirao', destination: 'ocian' }),
  });
  assert.equal(created.status, 200);
  const pushed = await readSSE(first.reader, first.buf);
  assert.equal(pushed.metrics.totalRides, 1, 'PG notification bridged to Redis and SSE');
  const realRides = await pool.query('SELECT COUNT(*)::int AS n FROM "Ride"');
  assert.equal(realRides.rows[0].n, 0);

  await first.reader.cancel();
  first.controller.abort();
  await waitFor(async () => (await redis.mGet([prefix + '0']))[0] === null, 'Redis slot released');
  const again = await stream();
  assert.equal(again.res.status, 200);
  assert.equal((await readSSE(again.reader, again.buf)).metrics.totalRides, 1);
  await again.reader.cancel();
  again.controller.abort();

  // Simulate 16 occupied broker slots without disabling auth rate limits.
  await waitFor(async () => (await redis.mGet([prefix + '0']))[0] === null, 'Redis reconnect slot released');
  for (let i = 0; i < 16; i++) await redis.set(prefix + i, 'fake-remote', { PX: 30000 });
  const blocked = await stream();
  assert.equal(blocked.res.status, 429);
  assert.equal((await blocked.res.json()).code, 'capacity_reached');
  await redis.del(prefix + '0');
  const recovered = await stream();
  assert.equal(recovered.res.status, 200, 'freed broker slot can be occupied');
  await recovered.reader.cancel();
  recovered.controller.abort();

  console.log('PASS: Redis bridge, admin auth, SSE updates, reconnect, unique-admin lease and distributed capacity.');
} catch (err) {
  console.error(err);
  console.error('Server / bridge logs:', logs.slice(-6500));
  process.exitCode = 1;
} finally {
  stop(server);
  stop(bridge);
  await pool.end();
  redis.destroy();
}
