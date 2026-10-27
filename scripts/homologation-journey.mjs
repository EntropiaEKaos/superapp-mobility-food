import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

/**
 * Isolated HTTP + PostgreSQL homologation journey. Not a real-money or GPS test.
 * Safe on ephemeral GitHub Actions CI only. Never points at a shared DB.
 */
if (process.env.CI !== 'true' || !process.env.DATABASE_URL?.includes('/superapp_ci')) {
  throw new Error('Homologation requires CI=true and an ephemeral superapp_ci database');
}
const port = 3191;
const origin = 'http://127.0.0.1:' + port;
const password = 'CI-only-staging-password-18!';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = spawn('npm', ['run', 'start', '-w', '@superapp/web', '--', '-p', String(port)], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
  env: {
    ...process.env,
    BETTER_AUTH_URL: origin, NEXT_PUBLIC_APP_URL: origin,
    ENABLE_SANDBOX_DISPATCH: 'true',
    SANDBOX_EVENT_TRANSPORT: 'postgres',
    SANDBOX_MONITOR_TOKEN: '',
  },
});
let serverLogs = '';
for (const stream of [app.stdout, app.stderr]) {
  stream.on('data', bytes => { serverLogs += String(bytes); });
}
const startedAt = new Date();
const cases = [];
let customerCookie;
let adminCookie;
let adminId;
let applicationId;
let rideId;
let winningDriverId;
let offeredIds;
let observedEvents = 0;

function stop() {
  if (!app.pid) return;
  try {
    if (process.platform === 'win32') app.kill('SIGTERM');
    else process.kill(-app.pid, 'SIGTERM');
  } catch { /* process exited */ }
}
async function api(path, { cookie, ...options } = {}) {
  return fetch(origin + path, {
    ...options,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(10000),
  });
}
async function post(path, data, cookie, extraHeaders = {}) {
  return api(path, {
    cookie,
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(data),
  });
}
async function step(name, fn) {
  const time = performance.now();
  try {
    const details = await fn();
    cases.push({ name, result: 'PASS', durationMs: Math.round(performance.now() - time), ...(details ?? {}) });
  } catch (error) {
    cases.push({ name, result: 'FAIL', durationMs: Math.round(performance.now() - time),
      failure: error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'STEP_ERROR' });
    throw error;
  }
}
async function signup(name, email) {
  const response = await post('/api/auth/sign-up/email', { name, email, password });
  assert.equal(response.status, 200, 'CI fixture signup');
  const cookie = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  assert.ok(cookie, 'session cookie must be issued');
  return cookie;
}
async function sandbox(data, cookie = adminCookie) {
  return post('/api/admin/sandbox-rides', data, cookie);
}
async function waitReady() {
  for (let i = 0; i < 90; i++) {
    if (app.exitCode !== null) throw new Error('App exited during E2E readiness');
    try {
      if ((await api('/api/health')).ok) return;
    } catch { /* server not listening yet */ }
    await sleep(250);
  }
  throw new Error('Homologation server did not start');
}
function report() {
  const overall = cases.every(item => item.result === 'PASS') && cases.length >= 12;
  const finishedAt = new Date();
  const report = {
    schemaVersion: 1,
    sprint: 18,
    suite: 'sandbox-homologation-http-e2e',
    environment: 'ephemeral-github-actions',
    actualDeployment: false,
    externalPayments: false,
    realDrivers: false,
    runId: process.env.GITHUB_RUN_ID ?? 'local-ci',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    status: overall ? 'PASS' : 'FAIL',
    total: cases.length,
    passed: cases.filter(item => item.result === 'PASS').length,
    failed: cases.filter(item => item.result === 'FAIL').length,
    persistedRideEventsVerified: observedEvents,
    cases,
  };
  mkdirSync('artifacts/homologation', { recursive: true });
  writeFileSync('artifacts/homologation/report.json', JSON.stringify(report, null, 2) + '\n');
  const rows = cases.map(item =>
    '| ' + item.name.replaceAll('|', '/') + ' | ' + item.result + ' | ' + item.durationMs + ' |'
  ).join('\n');
  writeFileSync('artifacts/homologation/report.md', [
    '# Sprint 18 — Relatório de homologação automatizada',
    '',
    '**Resultado: ' + report.status + '** · ' + report.passed + '/' + report.total +
      ' verificações aprovadas · GitHub run ' + report.runId,
    '',
    'Dados inteiramente fictícios em PostgreSQL efêmero. Nenhum deploy, pedido, motorista ou pagamento real.',
    '',
    '| Verificação | Resultado | Duração (ms) |',
    '| --- | --- | ---: |',
    rows,
    '',
    'Eventos imutáveis de corrida validados: ' + observedEvents,
    '',
    'Nota: testes HTTP/API e renderização SSR. Não são testes de navegação gráfica nem de desempenho comercial.',
    '',
  ].join('\n'));
  console.log('HOMOLOGATION_REPORT ' + JSON.stringify({
    status: report.status, passed: report.passed,
    failed: report.failed, events: observedEvents,
  }));
  return overall;
}

let errorFound = null;
try {
  await step('Next.js disponível no PostgreSQL efêmero', async () => {
    await waitReady();
    assert.equal((await api('/api/health')).status, 200);
  });
  await step('Catálogo e página de comida são demonstrativos', async () => {
    const response = await api('/api/food/restaurants');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.demo, true);
    assert.ok(data.restaurants.length >= 3);
    const page = await api('/food/demo-bistro');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Nenhum pedido é enviado ou cobrado/);
  });
  await step('Estimativa de corrida fictícia e coordenadas inválidas', async () => {
    const res = await post('/api/rides/estimate', {
      origin: { lat: -24.0057, lng: -46.4126 },
      destination: { lat: -24.0282, lng: -46.4756 }, category: 'economy',
    });
    assert.equal(res.status, 200);
    const quote = await res.json();
    assert.equal(quote.demo, true);
    assert.ok(quote.estimatedFareCents > 0);
    assert.equal((await post('/api/rides/estimate', {
      origin: { lat: 100, lng: 0 }, destination: { lat: 0, lng: 0 },
    })).status, 422);
  });
  await step('Dois perfis fictícios iniciam como CUSTOMER', async () => {
    customerCookie = await signup('Homologação Cliente', 'hml-customer-' + process.pid + '@example.invalid');
    adminCookie = await signup('Homologação Admin', 'hml-admin-' + process.pid + '@example.invalid');
    const customer = await pool.query('SELECT "id", "role" FROM "users" WHERE "name"=$1', ['Homologação Cliente']);
    const admin = await pool.query('SELECT "id", "role" FROM "users" WHERE "name"=$1', ['Homologação Admin']);
    assert.equal(customer.rows[0].role, 'CUSTOMER');
    assert.equal(admin.rows[0].role, 'CUSTOMER');
    adminId = admin.rows[0].id;
    assert.equal((await api('/admin', { cookie: customerCookie })).status, 200);
    assert.equal((await api('/api/admin/partner-applications', { cookie: customerCookie })).status, 403);
    assert.equal((await api('/api/admin/sandbox-rides', { cookie: customerCookie })).status, 403);
    assert.equal((await api('/api/admin/sandbox-rides')).status, 401);
  });
  await step('Cliente solicita parceria e não consegue aprovar', async () => {
    const result = await post('/api/partners/applications', {
      kind: 'DRIVER', displayName: 'Motorista Fictício 18', city: 'Praia Grande',
    }, customerCookie);
    assert.equal(result.status, 201);
    applicationId = (await result.json()).application.id;
    assert.equal((await post('/api/partners/applications', {
      kind: 'DRIVER', displayName: 'Motorista Duplicado', city: 'Praia Grande',
    }, customerCookie)).status, 409);
    const forbidden = await api('/api/admin/partner-applications', {
      cookie: customerCookie, method: 'PATCH',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: applicationId, decision: 'APPROVED' }),
    });
    assert.equal(forbidden.status, 403);
  });
  await step('Admin CI aprova solicitação e auditoria preserva perfil cliente', async () => {
    const role = await pool.query('UPDATE "users" SET "role"=$1 WHERE "id"=$2', ['ADMIN', adminId]);
    assert.equal(role.rowCount, 1);
    const response = await api('/api/admin/partner-applications', {
      cookie: adminCookie, method: 'PATCH',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: applicationId, decision: 'APPROVED' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).application.status, 'APPROVED');
    const record = await pool.query('SELECT "status", "reviewerId" FROM "PartnerApplication" WHERE "id"=$1', [applicationId]);
    assert.equal(record.rows[0].status, 'APPROVED');
    assert.equal(record.rows[0].reviewerId, adminId);
    const repeat = await api('/api/admin/partner-applications', {
      cookie: adminCookie, method: 'PATCH',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: applicationId, decision: 'REJECTED' }),
    });
    assert.equal(repeat.status, 409);
    const customer = await pool.query('SELECT "role" FROM "users" WHERE "name"=$1', ['Homologação Cliente']);
    assert.equal(customer.rows[0].role, 'CUSTOMER');
  });
  await step('Origem externa e cliente não alteram sandbox', async () => {
    assert.equal((await sandbox({ action: 'seed' }, customerCookie)).status, 403);
    const crossOrigin = await post('/api/admin/sandbox-rides',
      { action: 'seed' }, adminCookie, { Origin: 'https://attacker.example' });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await api('/api/ops/sandbox-health')).status, 503,
      'monitor must remain disabled without monitor secret');
  });
  await step('Admin inicializa veículos fictícios e cria corrida', async () => {
    assert.equal((await sandbox({ action: 'reset' })).status, 200);
    assert.equal((await sandbox({ action: 'seed' })).status, 200);
    const create = await sandbox({ action: 'create', origin: 'boqueirao', destination: 'ocian' });
    assert.equal(create.status, 200);
    rideId = (await create.json()).result.id;
    assert.ok(rideId);
  });
  await step('Ofertas paralelas resultam em exatamente um vencedor', async () => {
    const emit = await sandbox({ action: 'offer', rideId });
    assert.equal(emit.status, 200);
    offeredIds = (await emit.json()).result.offers.map(o => o.id);
    assert.equal(offeredIds.length, 2);
    const results = await Promise.all(offeredIds.map(offerId => sandbox({ action: 'accept', offerId })));
    assert.deepEqual(results.map(r => r.status).sort((a, b) => a - b), [200, 409]);
    const ride = await pool.query('SELECT "status", "acceptedDriverId" FROM "SandboxRide" WHERE "id"=$1', [rideId]);
    assert.equal(ride.rows[0].status, 'ACCEPTED');
    winningDriverId = ride.rows[0].acceptedDriverId;
    assert.ok(winningDriverId);
  });
  await step('Viagem percorre embarque, trajeto e conclusão fictícios', async () => {
    assert.equal((await sandbox({ action: 'arrive', rideId })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await sandbox({ action: 'advance', rideId })).status, 200);
    assert.equal((await sandbox({ action: 'start', rideId })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await sandbox({ action: 'advance', rideId })).status, 200);
    assert.equal((await sandbox({ action: 'complete', rideId })).status, 200);
    assert.equal((await sandbox({ action: 'complete', rideId })).status, 409);
  });
  await step('Histórico auditável íntegro e motorista liberado', async () => {
    const log = await pool.query(
      'SELECT "sequence", "type" FROM "SandboxRideEvent" WHERE "rideId"=$1 ORDER BY "sequence"',
      [rideId],
    );
    const events = log.rows;
    observedEvents = events.length;
    assert.deepEqual(events.map(e => e.sequence), events.map((_, i) => i + 1));
    assert.equal(events.length, 16);
    assert.equal(events[0].type, 'CREATED');
    assert.equal(events.at(-1).type, 'COMPLETED');
    assert.equal(events.filter(e => e.type === 'LOCATION_UPDATED').length, 10);
    const busy = await pool.query('SELECT "busy" FROM "SandboxDriver" WHERE "id"=$1', [winningDriverId]);
    assert.equal(busy.rows[0].busy, false);
    const commercialRides = await pool.query('SELECT COUNT(*)::int AS total FROM "Ride"');
    assert.equal(commercialRides.rows[0].total, 0);
  });
  await step('Corrida expirada não admite aceite posterior', async () => {
    const created = await sandbox({ action: 'create', origin: 'boqueirao', destination: 'guilhermina' });
    assert.equal(created.status, 200);
    const id = (await created.json()).result.id;
    const offers = await sandbox({ action: 'offer', rideId: id });
    assert.equal(offers.status, 200);
    const offersIds = (await offers.json()).result.offers.map(o => o.id);
    const expiry = await sandbox({ action: 'expire', rideId: id, advanceSeconds: 45 });
    assert.equal(expiry.status, 200);
    assert.equal((await expiry.json()).result.status, 'EXPIRED');
    assert.equal((await sandbox({ action: 'accept', offerId: offersIds[0] })).status, 409);
  });
  await step('Cancelamento fictício não modifica corridas comerciais', async () => {
    const created = await sandbox({ action: 'create', origin: 'boqueirao', destination: 'caicara' });
    assert.equal(created.status, 200);
    const id = (await created.json()).result.id;
    assert.equal((await sandbox({ action: 'offer', rideId: id })).status, 200);
    assert.equal((await sandbox({ action: 'cancel', rideId: id })).status, 200);
    assert.equal((await sandbox({ action: 'cancel', rideId: id })).status, 409);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS total FROM "Ride"')).rows[0].total, 0);
  });
  await step('Painel admin lê dados coerentes sem criar eventos', async () => {
    const before = (await pool.query('SELECT COUNT(*)::int AS n FROM "SandboxRideEvent"')).rows[0].n;
    const dashboard = await api('/api/admin/sandbox-rides', { cookie: adminCookie });
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.headers.get('cache-control') ?? '', /no-store/);
    const value = await dashboard.json();
    assert.equal(value.demo, true);
    assert.equal(value.metrics.completedRides, 1);
    assert.equal(value.metrics.ridesByStatus.EXPIRED, 1);
    assert.equal(value.metrics.ridesByStatus.CANCELED, 1);
    assert.ok(value.outboxHealth.pending > 0, 'PostgreSQL transport keeps outbox records pending');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM "SandboxRideEvent"')).rows[0].n, before);
    const page = await api('/admin/sandbox-rides', { cookie: adminCookie });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Central de operações simuladas/);
  });
} catch (error) {
  errorFound = error;
  console.error('HOMOLOGATION_FAILED:', error?.message ?? 'Unknown error');
  console.error('Server excerpt:', serverLogs.slice(-1800));
} finally {
  const success = report();
  stop();
  await pool.end();
  if (!success || errorFound) process.exitCode = 1;
}
