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
  // Sprint 10: SSE stream must be protected and receive PostgreSQL notifications
  // without creating a record of its own. A new connection begins with a full snapshot.
  const streamPath = '/api/admin/sandbox-rides/stream';
  assert.equal((await request(streamPath)).status, 401);
  assert.equal((await request(streamPath, { headers: { Cookie: cookies } })).status, 403);
  const streamAbort = new AbortController();
  const streamResponse = await fetch(origin + streamPath, {
    headers: { Cookie: adminCookie },
    signal: streamAbort.signal,
  });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.match(streamResponse.headers.get('cache-control') ?? '', /no-store/);
  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let frames = '';
  async function readSnapshotFromStream() {
    for (let attempts = 0; attempts < 100; attempts++) {
      let separator = frames.indexOf('\n\n');
      while (separator >= 0) {
        const message = frames.slice(0, separator);
        frames = frames.slice(separator + 2);
        if (message.includes('event: snapshot')) {
          const data = message.split('\n').find(line => line.startsWith('data: '));
          assert.ok(data, 'event snapshot must contain data');
          return JSON.parse(data.slice(6));
        }
        separator = frames.indexOf('\n\n');
      }
      const chunk = await Promise.race([
        reader.read(),
        sleep(9000).then(() => { throw new Error('SSE packet timeout'); }),
      ]);
      assert.equal(chunk.done, false, 'SSE stream should remain open during the test');
      frames += decoder.decode(chunk.value, { stream: true });
    }
    throw new Error('No SSE snapshot received');
  }
  const firstStreamSnapshot = await readSnapshotFromStream();
  assert.equal(firstStreamSnapshot.demo, true);
  assert.equal(firstStreamSnapshot.metrics.totalRides, 0);

  const createdRide = await sandboxCall(adminCookie, { action: 'create', origin: 'boqueirao', destination: 'ocian' });
  assert.equal(createdRide.status, 200);
  const rideId = (await createdRide.json()).result.id;
  const liveSnapshot = await readSnapshotFromStream();
  assert.equal(liveSnapshot.metrics.totalRides, firstStreamSnapshot.metrics.totalRides + 1,
    'PostgreSQL NOTIFY must push the new ride without client polling');
  await reader.cancel();
  streamAbort.abort();

  // Reconnect must start with a fresh full snapshot (no unsafe incremental replay).
  const reconnectAbort = new AbortController();
  const reconnect = await fetch(origin + streamPath, {
    headers: { Cookie: adminCookie }, signal: reconnectAbort.signal,
  });
  assert.equal(reconnect.status, 200);
  const reconnectReader = reconnect.body.getReader();
  let reconnectFrames = '';
  let reconnectSnapshot = null;
  const reconnectDecoder = new TextDecoder();
  while (!reconnectSnapshot) {
    const packet = await Promise.race([
      reconnectReader.read(),
      sleep(9000).then(() => { throw new Error('Reconnect snapshot timeout'); }),
    ]);
    assert.equal(packet.done, false);
    reconnectFrames += reconnectDecoder.decode(packet.value, { stream: true });
    let boundary = reconnectFrames.indexOf('\n\n');
    while (boundary >= 0) {
      const message = reconnectFrames.slice(0, boundary);
      reconnectFrames = reconnectFrames.slice(boundary + 2);
      if (message.includes('event: snapshot')) {
        const data = message.split('\n').find(line => line.startsWith('data: '));
        reconnectSnapshot = JSON.parse(data.slice(6));
        break;
      }
      boundary = reconnectFrames.indexOf('\n\n');
    }
  }
  assert.equal(reconnectSnapshot.metrics.totalRides, 1);
  await reconnectReader.cancel();
  reconnectAbort.abort();

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

  // New state machine: no direct ACCEPTED -> COMPLETED shortcut.
  assert.equal((await sandboxCall(adminCookie, { action: 'complete', rideId })).status, 409);
  assert.equal((await sandboxCall(adminCookie, { action: 'start', rideId })).status, 409);
  assert.equal((await sandboxCall(adminCookie, { action: 'arrive', rideId })).status, 200);
  const routePage = await request('/admin/sandbox-rides', { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(routePage.status, 200);
  const routeHtml = await routePage.text();
  assert.match(routeHtml, /Trajeto ilustrativo, sem mapa ou GPS/, 'route schematic should appear for an active demo ride');
  assert.match(routeHtml, /Atualização automática/, 'admin may pause/resume polling');

  assert.equal((await sandboxCall(adminCookie, { action: 'start', rideId })).status, 409, 'pickup stage requires all waypoints');

  // Simultaneous progress attempts must not commit duplicate sequence numbers.
  const steps = await Promise.all([
    sandboxCall(adminCookie, { action: 'advance', rideId }),
    sandboxCall(adminCookie, { action: 'advance', rideId }),
  ]);
  assert.deepEqual(steps.map(x => x.status).sort((a, b) => a - b), [200, 409],
    'concurrent tracking updates must have exactly one winner');
  for (let index = 1; index < 5; index++) {
    assert.equal((await sandboxCall(adminCookie, { action: 'advance', rideId })).status, 200);
  }
  assert.equal((await sandboxCall(adminCookie, { action: 'advance', rideId })).status, 409,
    'completed approach cannot move past waypoint 5');
  assert.equal((await sandboxCall(adminCookie, { action: 'start', rideId })).status, 200);
  assert.equal((await sandboxCall(adminCookie, { action: 'complete', rideId })).status, 409,
    'in-progress stage requires final waypoint');
  for (let index = 0; index < 5; index++) {
    assert.equal((await sandboxCall(adminCookie, { action: 'advance', rideId })).status, 200);
  }
  assert.equal((await sandboxCall(adminCookie, { action: 'complete', rideId })).status, 200);
  assert.equal((await sandboxCall(adminCookie, { action: 'complete', rideId })).status, 409);
  assert.equal((await sandboxCall(adminCookie, { action: 'cancel', rideId })).status, 409,
    'completed rides must be immutable');
  const released = await pool.query('SELECT "busy" FROM "SandboxDriver" WHERE "id" = $1', [ledger.rows[0].acceptedDriverId]);
  assert.equal(released.rows[0].busy, false, 'completing the demo ride releases the simulated driver');

  const journey = await pool.query(
    'SELECT "sequence", "type", "progressStep", "latitude", "longitude" FROM "SandboxRideEvent" WHERE "rideId"=$1 ORDER BY "sequence"',
    [rideId],
  );
  const events = journey.rows;
  assert.deepEqual(events.map(e => e.sequence), events.map((_, i) => i + 1),
    'the event log must be append-only with contiguous versions');
  assert.equal(events[0].type, 'CREATED');
  assert.ok(events.some(e => e.type === 'OFFERED'));
  assert.ok(events.some(e => e.type === 'ACCEPTED'));
  assert.ok(events.some(e => e.type === 'ARRIVING'));
  assert.ok(events.some(e => e.type === 'IN_PROGRESS'));
  assert.equal(events.filter(e => e.type === 'LOCATION_UPDATED').length, 10);
  assert.equal(events.at(-1).type, 'COMPLETED');
  assert.ok(events.filter(e => e.type === 'LOCATION_UPDATED').every(e =>
    Number.isFinite(e.latitude) && Number.isFinite(e.longitude)), 'tracking coordinates must be deterministic numeric points');

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
  const canceled = await sandboxCall(adminCookie, { action: 'create', origin: 'boqueirao', destination: 'caicara' });
  assert.equal(canceled.status, 200);
  const canceledRideId = (await canceled.json()).result.id;
  assert.equal((await sandboxCall(adminCookie, { action: 'offer', rideId: canceledRideId })).status, 200);
  assert.equal((await sandboxCall(adminCookie, { action: 'cancel', rideId: canceledRideId })).status, 200);
  assert.equal((await sandboxCall(adminCookie, { action: 'cancel', rideId: canceledRideId })).status, 409);
  const canceledLedger = await pool.query(
    'SELECT "status" FROM "SandboxRideOffer" WHERE "rideId" = $1', [canceledRideId]);
  assert.ok(canceledLedger.rows.every(row => row.status === 'DECLINED'));
  const canceledEvents = await pool.query(
    'SELECT "type" FROM "SandboxRideEvent" WHERE "rideId" = $1 ORDER BY "sequence"', [canceledRideId]);
  assert.equal(canceledEvents.rows.at(-1).type, 'CANCELED');


  // A fictitious ride never inserts a real passenger Ride or dispatches drivers.
  const productionRides = await pool.query('SELECT COUNT(*)::int AS count FROM "Ride"');
  assert.equal(productionRides.rows[0].count, 0);
  const sandboxPage = await request('/admin/sandbox-rides', { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(sandboxPage.status, 200);
  assert.match(await sandboxPage.text(), /Central de operações simuladas/);
  // Sprint 08: global aggregates and bounded activity list must agree with the database.
  const opsResponse = await request(sandboxPath, { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(opsResponse.status, 200);
  assert.match(opsResponse.headers.get('cache-control') ?? '', /no-store/);
  const beforeReads = await pool.query('SELECT COUNT(*)::int AS total FROM "SandboxRideEvent"');
  const repeatRead = await request(sandboxPath, { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(repeatRead.status, 200);
  const afterReads = await pool.query('SELECT COUNT(*)::int AS total FROM "SandboxRideEvent"');
  assert.equal(afterReads.rows[0].total, beforeReads.rows[0].total, 'polling reads must not create events');
  const ops = await opsResponse.json();
  assert.equal(ops.demo, true);
  assert.ok(ops.generatedAt);
  assert.equal(ops.recentLimit, 20);
  const allRides = await pool.query('SELECT COUNT(*)::int AS total FROM "SandboxRide"');
  assert.equal(ops.metrics.totalRides, allRides.rows[0].total);
  assert.equal(ops.metrics.totalRides,
    Object.values(ops.metrics.ridesByStatus).reduce((a, b) => a + b, 0));
  assert.equal(ops.metrics.completedRides, 1);
  assert.equal(ops.metrics.activeRides, 0);
  assert.equal(ops.metrics.eventCount,
    Number((await pool.query('SELECT COUNT(*)::int AS total FROM "SandboxRideEvent"')).rows[0].total));
  assert.ok(ops.recentEvents.some(event => event.type === 'COMPLETED'));
  assert.ok(ops.recentEvents.length <= 12);
  assert.equal(ops.metrics.totalDrivers, 3);
  assert.ok(Array.isArray(ops.diagnostics));

  // A pending offer past its deadline must appear in the diagnostic read model.
  const overdueCreation = await sandboxCall(adminCookie, { action: 'create', origin: 'boqueirao', destination: 'caicara' });
  assert.equal(overdueCreation.status, 200);
  const overdueRideId = (await overdueCreation.json()).result.id;
  assert.equal((await sandboxCall(adminCookie, { action: 'offer', rideId: overdueRideId })).status, 200);
  await pool.query('UPDATE "SandboxRideOffer" SET "expiresAt" = NOW() - INTERVAL \'2 minutes\' WHERE "rideId" = $1', [overdueRideId]);
  const flagged = await request(sandboxPath, { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(flagged.status, 200);
  const flaggedSnapshot = await flagged.json();
  assert.equal(flaggedSnapshot.metrics.overdueOffers, 2);
  assert.ok(flaggedSnapshot.diagnostics.some(item =>
    item.rideId === overdueRideId && item.code === 'OVERDUE_OFFER'));
  assert.equal((await sandboxCall(adminCookie, { action: 'expire', rideId: overdueRideId })).status, 200);
  const afterExpiry = await request(sandboxPath, { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(afterExpiry.status, 200);
  const cleanOps = await afterExpiry.json();
  assert.equal(cleanOps.metrics.overdueOffers, 0);
  assert.ok(!cleanOps.diagnostics.some(item => item.code === 'OVERDUE_OFFER'));
  assert.equal(cleanOps.metrics.ridesByStatus.EXPIRED, 2);
  assert.equal(cleanOps.metrics.ridesByStatus.COMPLETED, 1);

  const operationsPage = await request('/admin/sandbox-rides', { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(operationsPage.status, 200);
  const operationsHtml = await operationsPage.text();
  assert.match(operationsHtml, /Visão geral da operação/);
  assert.match(operationsHtml, /Diagnóstico de integridade/);
  assert.match(operationsHtml, /Eventos recentes/);
  assert.match(operationsHtml, /Conectando ao fluxo de eventos/, 'SSE connection state should render');
  assert.match(operationsHtml, /Modo alternativo: consulta periódica|Fallback GET a cada 6 s/, 'fallback information must be visible');



  // Sprint 11: capacity is shared through PostgreSQL session advisory locks.
  // Register fake admins to simulate different administrators sharing one database.
  const sockets = [];
  const streamTestUsers = [];
  async function streamFor(cookie) {
    const controller = new AbortController();
    const response = await fetch(origin + streamPath, {
      headers: { Cookie: cookie }, signal: controller.signal,
    });
    if (response.status !== 200) {
      // An HTTP 429 is a finite JSON response: let callers inspect it
      // before discarding the request. Aborting first breaks response.json().
      return { response, controller: null };
    }
    const reader = response.body.getReader();
    const firstPacket = await reader.read();
    assert.equal(firstPacket.done, false, 'each admitted SSE must send initial data');
    sockets.push({ controller, reader });
    return { response, controller };
  }
  try {
    const firstAdminStream = await streamFor(adminCookie);
    assert.equal(firstAdminStream.response.status, 200);
    const sameAdminStream = await streamFor(adminCookie);
    assert.equal(sameAdminStream.response.status, 429, 'only one active stream per admin');
    assert.equal((await sameAdminStream.response.json()).code, 'user_busy');
    assert.equal(sameAdminStream.response.headers.get('retry-after'), '30');

    for (let i = 1; i < 8; i++) {
      const nextEmail = `sse-admin-${process.pid}-${i}@example.invalid`;
      const createdAccount = await request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ name: `CI Stream Admin ${i}`, email: nextEmail, password }),
      });
      assert.equal(createdAccount.status, 200, 'fake admin account registered');
      const nextCookie = createdAccount.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
      assert.ok(nextCookie);
      await pool.query('UPDATE "users" SET "role" = $1 WHERE "email" = $2', ['ADMIN', nextEmail]);
      streamTestUsers.push(nextCookie);
      const open = await streamFor(nextCookie);
      assert.equal(open.response.status, 200, `SSE stream ${i} of eight must be admitted`);
    }

    const health = await request(sandboxPath, { headers: { Cookie: adminCookie, Origin: origin } });
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.streamHealth.capacity, 8);
    assert.equal(healthBody.streamHealth.activeConnections, 8);
    assert.equal(healthBody.streamHealth.availableSlots, 0);
    assert.equal(healthBody.streamHealth.utilizationPercent, 100);

    const lastEmail = `sse-admin-${process.pid}-overflow@example.invalid`;
    const lastRegister = await request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ name: 'CI Overflow Admin', email: lastEmail, password }),
    });
    assert.equal(lastRegister.status, 200);
    const lastCookie = lastRegister.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    await pool.query('UPDATE "users" SET "role" = $1 WHERE "email" = $2', ['ADMIN', lastEmail]);
    const ninth = await streamFor(lastCookie);
    assert.equal(ninth.response.status, 429, 'ninth admin cannot consume a ninth DB connection');
    assert.equal((await ninth.response.json()).code, 'capacity_reached');

    await sockets[0].reader.cancel();
    sockets[0].controller.abort();
    for (let i = 0; i < 40; i++) {
      const state = await request(sandboxPath, { headers: { Cookie: adminCookie, Origin: origin } });
      const data = await state.json();
      if (data.streamHealth.activeConnections === 7) break;
      await sleep(100);
    }
    const reopened = await streamFor(lastCookie);
    assert.equal(reopened.response.status, 200, 'capacity must be released when an SSE client disconnects');
    const finalHealth = await request(sandboxPath, { headers: { Cookie: adminCookie, Origin: origin } });
    const finalState = await finalHealth.json();
    assert.equal(finalState.streamHealth.activeConnections, 8, 'all eight stream slots reused safely');
    assert.equal(finalState.streamHealth.availableSlots, 0);
  } finally {
    for (const socket of sockets) {
      await socket.reader.cancel().catch(() => undefined);
      socket.controller.abort();
    }
  }
  const finalOperations = await request('/admin/sandbox-rides', { headers: { Cookie: adminCookie, Origin: origin } });
  assert.equal(finalOperations.status, 200);
  assert.match(await finalOperations.text(), /Conexões em tempo real/);

  console.log('PASS: auth, SSE notify/reconnect, eight global slots, admin uniqueness, capacity release and ride concurrency.');

} catch (error) {
  console.error(error);
  console.error('Web server logs:', logs.slice(-7000));
  process.exitCode = 1;
} finally {
  stop();
  await pool.end();
}
