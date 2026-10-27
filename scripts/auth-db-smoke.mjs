import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

/**
 * End-to-end auth/database smoke check against a temporary PostgreSQL in CI.
 * All data is fake and isolated to the ephemeral test database.
 */
const port = 3188;
const origin = `http://localhost:${port}`;
const email = `smoke-${process.pid}@example.invalid`;
const password = 'Only-For-CI-Password-9321!';
const app = spawn('npm', ['run', 'start', '-w', '@superapp/web', '--', '-p', String(port)], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BETTER_AUTH_URL: origin, NEXT_PUBLIC_APP_URL: origin },
  detached: process.platform !== 'win32',
});
let logs = '';
for (const stream of [app.stdout, app.stderr]) {
  stream.on('data', chunk => { logs += String(chunk); });
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function request(path, options = {}) {
  return fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) });
}
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    if (app.exitCode !== null) throw new Error('Web server exited during startup');
    try {
      const res = await request('/api/health');
      if (res.ok) return;
    } catch { /* still starting */ }
    await sleep(500);
  }
  throw new Error('Web server did not become ready');
}
function stop() {
  if (!app.pid) return;
  try {
    if (process.platform === 'win32') app.kill('SIGTERM');
    else process.kill(-app.pid, 'SIGTERM');
  } catch { /* already stopped */ }
}

try {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must exist');
  assert.ok(process.env.BETTER_AUTH_SECRET?.length >= 32, 'BETTER_AUTH_SECRET must be a test-only value');
  await waitReady();

  const anonymous = await request('/account', { redirect: 'manual' });
  assert.ok([302, 303, 307, 308].includes(anonymous.status), 'anonymous user must be redirected');

  const register = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': origin },
    body: JSON.stringify({ name: 'CI Example Customer', email, password }),
  });
  const registerBody = await register.text();
  assert.ok(register.ok, `sign-up failed ${register.status}: ${registerBody.slice(0, 500)}`);
  const cookies = register.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  assert.ok(cookies, 'sign-up should issue an authenticated session cookie');

  const session = await request('/api/auth/get-session', { headers: { Cookie: cookies, Origin: origin } });
  assert.equal(session.status, 200);
  const sessionBody = await session.json();
  assert.equal(sessionBody?.user?.email, email, 'signed-in user should be readable');

  const { rows } = await pool.query('SELECT "role" FROM "users" WHERE "email" = $1', [email]);
  assert.equal(rows.length, 1, 'user row persisted in PostgreSQL');
  assert.equal(rows[0].role, 'CUSTOMER', 'new accounts must never start with a privileged role');

  const account = await request('/account', { headers: { Cookie: cookies, Origin: origin } });
  assert.equal(account.status, 200);
  assert.match(await account.text(), /CI Example Customer/);

  const admin = await request('/admin', { headers: { Cookie: cookies, Origin: origin } });
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Acesso restrito/, 'customer account must not access admin');

  // Pending applications are always bound to the signed-in user's session.
  const anonymousApplications = await request('/api/partners/applications');
  assert.equal(anonymousApplications.status, 401, 'anonymous users cannot list applications');

  const invalidApplication = await request('/api/partners/applications', {
    method: 'POST',
    headers: { Cookie: cookies, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'ADMIN', displayName: 'Bad role', city: 'Praia Grande' }),
  });
  assert.equal(invalidApplication.status, 422, 'partner kind must be whitelisted');

  const apply = await request('/api/partners/applications', {
    method: 'POST',
    headers: { Cookie: cookies, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'DRIVER', displayName: 'CI Motorista', city: 'Praia Grande' }),
  });
  const applyBody = await apply.text();
  assert.equal(apply.status, 201, 'first application accepted: ' + applyBody.slice(0, 400));
  const created = JSON.parse(applyBody);
  assert.equal(created.application.status, 'PENDING', 'application never starts approved');

  const duplicate = await request('/api/partners/applications', {
    method: 'POST',
    headers: { Cookie: cookies, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'DRIVER', displayName: 'Duplicado', city: 'Praia Grande' }),
  });
  assert.equal(duplicate.status, 409, 'one request per user per kind is enforced by PostgreSQL');

  const mine = await request('/api/partners/applications', { headers: { Cookie: cookies, Origin: origin } });
  assert.equal(mine.status, 200);
  const mineBody = await mine.json();
  assert.equal(mineBody.applications.length, 1);
  assert.equal(mineBody.applications[0].kind, 'DRIVER');

  const updatedRoles = await pool.query('SELECT "role" FROM "users" WHERE "email" = $1', [email]);
  assert.equal(updatedRoles.rows[0].role, 'CUSTOMER', 'applicant cannot self-promote to professional roles');
  const onboardingPage = await request('/partners/apply', { headers: { Cookie: cookies, Origin: origin } });
  assert.equal(onboardingPage.status, 200);
  assert.match(await onboardingPage.text(), /CI Motorista/);

  console.log('PASS: migrations, sign-up, sessions, admin deny, pending partner application, ownership and uniqueness.');
} catch (error) {
  console.error(error);
  console.error('Web server logs:', logs.slice(-7000));
  process.exitCode = 1;
} finally {
  stop();
  await pool.end();
}
