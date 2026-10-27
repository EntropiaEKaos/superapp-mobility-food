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


  // Admin review is server-authorized and cannot change the applicant's role.
  const anonymousReview = await request('/api/admin/partner-applications');
  assert.equal(anonymousReview.status, 401);
  const unauthorizedReview = await request('/api/admin/partner-applications', {
    headers: { Cookie: cookies, Origin: origin },
  });
  assert.equal(unauthorizedReview.status, 403, 'ordinary customers cannot list the admin queue');
  const customerDecision = await request('/api/admin/partner-applications', {
    method: 'PATCH', headers: { Cookie: cookies, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: created.application.id, decision: 'APPROVED' }),
  });
  assert.equal(customerDecision.status, 403, 'ordinary customers cannot approve applications');

  const adminEmail = `admin-${process.pid}@example.invalid`;
  const adminRegister = await request('/api/auth/sign-up/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ name: 'CI Admin', email: adminEmail, password }),
  });
  assert.equal(adminRegister.status, 200, 'admin account must first register as a normal customer');
  const adminCookie = adminRegister.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  assert.ok(adminCookie);
  // CI-only trusted bootstrap; production must provision admins out-of-band.
  const promoted = await pool.query('UPDATE "users" SET "role" = $1 WHERE "email" = $2', ['ADMIN', adminEmail]);
  assert.equal(promoted.rowCount, 1);

  const queue = await request('/api/admin/partner-applications', { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(queue.status, 200);
  const queueBody = await queue.json();
  assert.ok(queueBody.applications.some(item => item.id === created.application.id));

  const adminPage = await request('/admin', { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(adminPage.status, 200);
  assert.match(await adminPage.text(), /Análise de parceiros/);

  const forged = await request('/api/admin/partner-applications', {
    method: 'PATCH', headers: { Cookie: adminCookie, Origin: 'https://wrong.example.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: created.application.id, decision: 'APPROVED' }),
  });
  assert.equal(forged.status, 403, 'cross-origin admin decision must be rejected');

  const invalidDecision = await request('/api/admin/partner-applications', {
    method: 'PATCH', headers: { Cookie: adminCookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: created.application.id, decision: 'ADMIN' }),
  });
  assert.equal(invalidDecision.status, 422);

  const approve = await request('/api/admin/partner-applications', {
    method: 'PATCH', headers: { Cookie: adminCookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: created.application.id, decision: 'APPROVED' }),
  });
  const approvedBody = await approve.text();
  assert.equal(approve.status, 200, 'approval succeeds: ' + approvedBody.slice(0, 500));
  const decisionRecord = await pool.query('SELECT "status", "reviewerId", "reviewedAt" FROM "PartnerApplication" WHERE "id" = $1', [created.application.id]);
  assert.equal(decisionRecord.rows[0].status, 'APPROVED');
  assert.ok(decisionRecord.rows[0].reviewerId);
  assert.ok(decisionRecord.rows[0].reviewedAt);

  const replay = await request('/api/admin/partner-applications', {
    method: 'PATCH', headers: { Cookie: adminCookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: created.application.id, decision: 'REJECTED' }),
  });
  assert.equal(replay.status, 409, 'a second decision cannot overwrite the first');

  const applicantRole = await pool.query('SELECT "role" FROM "users" WHERE "email" = $1', [email]);
  assert.equal(applicantRole.rows[0].role, 'CUSTOMER', 'application approval never grants driver or admin role');

  const ownApplication = await request('/api/partners/applications', {
    method: 'POST', headers: { Cookie: adminCookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'COURIER', displayName: 'Admin Applicant', city: 'Praia Grande' }),
  });
  assert.equal(ownApplication.status, 201);
  const own = await ownApplication.json();
  const selfApproval = await request('/api/admin/partner-applications', {
    method: 'PATCH', headers: { Cookie: adminCookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: own.application.id, decision: 'APPROVED' }),
  });
  assert.equal(selfApproval.status, 409, 'administrators must not review their own applications');

  // Sandbox is admin-only, completely separate from real rides and offers.
  const sandboxPath = '/api/admin/sandbox-rides';
  const sandboxCall = (cookie, data, extraHeaders = {}) => request(sandboxPath, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(data),
  });
  const sandboxAnonymous = await request(sandboxPath);
  assert.equal(sandboxAnonymous.status, 401, 'anonymous cannot inspect simulated rides');
  const sandboxCustomer = await request(sandboxPath, { headers: { Cookie: cookies, Origin: origin } });
  assert.equal(sandboxCustomer.status, 403, 'customers cannot access sandbox');
  const crossOrigin = await sandboxCall(adminCookie, { action: 'seed' }, { Origin: 'https://forged.invalid' });
  assert.equal(crossOrigin.status, 403, 'admin sandbox mutation requires matching Origin');
  assert.equal((await sandboxCall(adminCookie, { action: 'reset' })).status, 200);
  const seeded = await sandboxCall(adminCookie, { action: 'seed' });
  assert.equal(seeded.status, 200);
  const createdRide = await sandboxCall(adminCookie, { action: 'create', origin: 'boqueirao', destination: 'ocian' });
  assert.equal(createdRide.status, 200);
  const rideId = (await createdRide.json()).result.id;
  const offerResponse = await sandboxCall(adminCookie, { action: 'offer', rideId });
  assert.equal(offerResponse.status, 200);
  const offered = (await offerResponse.json()).result;
  assert.equal(offered.offers.length, 2, 'each ride should get two independent fictitious offers');

  const [first, second] = await Promise.all(offered.offers.map(o =>
    sandboxCall(adminCookie, { action: 'accept', offerId: o.id })
  ));
  assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [200, 409],
    'two simultaneous accepts must produce exactly one winner');
  const ledger = await pool.query('SELECT "status", "acceptedDriverId" FROM "SandboxRide" WHERE "id" = $1', [rideId]);
  assert.equal(ledger.rows[0].status, 'ACCEPTED');
  assert.ok(ledger.rows[0].acceptedDriverId);
  const statuses = await pool.query('SELECT "status" FROM "SandboxRideOffer" WHERE "rideId" = $1', [rideId]);
  assert.deepEqual(statuses.rows.map(row => row.status).sort(), ['ACCEPTED', 'DECLINED']);
  const busyDriver = await pool.query('SELECT "busy" FROM "SandboxDriver" WHERE "id" = $1', [ledger.rows[0].acceptedDriverId]);
  assert.equal(busyDriver.rows[0].busy, true, 'winning driver reserved exactly once');
  assert.equal((await sandboxCall(adminCookie, { action: 'complete', rideId })).status, 200);
  assert.equal((await sandboxCall(adminCookie, { action: 'complete', rideId })).status, 409);
  const released = await pool.query('SELECT "busy" FROM "SandboxDriver" WHERE "id" = $1', [ledger.rows[0].acceptedDriverId]);
  assert.equal(released.rows[0].busy, false, 'completing the demo ride releases the simulated driver');

  const newRide = await sandboxCall(adminCookie, { action: 'create', origin: 'boqueirao', destination: 'guilhermina' });
  assert.equal(newRide.status, 200);
  const expiredRideId = (await newRide.json()).result.id;
  const newOffers = await sandboxCall(adminCookie, { action: 'offer', rideId: expiredRideId });
  assert.equal(newOffers.status, 200);
  const staleOffers = (await newOffers.json()).result.offers;
  const expiry = await sandboxCall(adminCookie, { action: 'expire', rideId: expiredRideId, advanceSeconds: 45 });
  assert.equal(expiry.status, 200);
  const expiredRecord = (await expiry.json()).result;
  assert.equal(expiredRecord.status, 'EXPIRED');
  assert.ok(expiredRecord.offers.every(o => o.status === 'EXPIRED'));
  assert.equal((await sandboxCall(adminCookie, { action: 'accept', offerId: staleOffers[0].id })).status, 409,
    'expired offers must not be accepted');

  // A fictitious ride never inserts a real passenger Ride or dispatches drivers.
  const productionRides = await pool.query('SELECT COUNT(*)::int AS count FROM "Ride"');
  assert.equal(productionRides.rows[0].count, 0);
  const sandboxPage = await request('/admin/sandbox-rides', { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(sandboxPage.status, 200);
  assert.match(await sandboxPage.text(), /Corridas simuladas com ofertas/);

  console.log('PASS: auth/partner admin review plus isolated sandbox offers, concurrent acceptance, expiry and driver release.');
} catch (error) {
  console.error(error);
  console.error('Web server logs:', logs.slice(-7000));
  process.exitCode = 1;
} finally {
  stop();
  await pool.end();
}
