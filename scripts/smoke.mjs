import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// Built application smoke checks. No PostgreSQL or payment credentials required.
const port = 3187;
const base = `http://127.0.0.1:${port}`;
const child = spawn('npm', ['run', 'start', '-w', '@superapp/web', '--', '-p', String(port)], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
  env: { ...process.env, DATABASE_URL: '', BETTER_AUTH_SECRET: '' },
});
let logs = '';
child.stdout.on('data', chunk => { logs += chunk.toString(); });
child.stderr.on('data', chunk => { logs += chunk.toString(); });

async function response(path, init = {}) {
  return fetch(base + path, { ...init, signal: AbortSignal.timeout(4000) });
}
async function ready() {
  for (let i = 0; i < 35; i++) {
    if (child.exitCode !== null) throw new Error('Server exited before becoming ready.');
    try {
      const res = await response('/api/health');
      if (res.ok) return;
    } catch { /* server starting */ }
    await sleep(400);
  }
  throw new Error('Server did not start in demo mode.');
}
function stop() {
  if (!child.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch { /* already terminated */ }
}

try {
  await ready();
  const home = await response('/');
  assert.equal(home.status, 200, 'home must render');
  const html = await home.text();
  assert.match(html, /Sua cidade/);

  const restaurant = await response('/food/demo-bistro');
  assert.equal(restaurant.status, 200, 'restaurant menu must render');
  assert.match(await restaurant.text(), /Meu carrinho/);

  const catalog = await response('/api/food/restaurants');
  assert.equal(catalog.status, 200);
  const data = await catalog.json();
  assert.equal(data.demo, true);
  assert.ok(data.restaurants.length >= 3);

  const estimate = await response('/api/rides/estimate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: { lat: -24.0057, lng: -46.4126 },
      destination: { lat: -24.0282, lng: -46.4756 },
      category: 'economy',
    }),
  });
  assert.equal(estimate.status, 200);
  const quote = await estimate.json();
  assert.equal(quote.demo, true);
  assert.ok(quote.estimatedFareCents > 0);

  const bad = await response('/api/rides/estimate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origin: { lat: 500, lng: 0 }, destination: { lat: 0, lng: 0 } }),
  });
  assert.equal(bad.status, 422, 'invalid geographic coordinates must be rejected');

  const dispatchDemo = await response('/rides/dispatch-demo');
  assert.equal(dispatchDemo.status, 200, 'dispatch prototype page must render');
  const dispatchHtml = await dispatchDemo.text();
  assert.match(dispatchHtml, /Quem receberia a corrida/);
  assert.match(dispatchHtml, /Carro Alpha/);
  assert.doesNotMatch(dispatchHtml, /Carro Charlie \(ocupado\)/, 'busy driver is ineligible');

  const protectedReview = await response('/api/admin/partner-applications');
  assert.equal(protectedReview.status, 503, 'admin API must stay disabled in no-database demo');

  const gated = await response('/api/admin/sandbox-rides');
  assert.equal(gated.status, 503, 'ride laboratory remains disabled without explicit flag and secrets');

  const streamed = await response('/api/admin/sandbox-rides/stream');
  assert.equal(streamed.status, 503, 'admin event stream must remain disabled in demo mode');

  const auth = await response('/api/auth/get-session');
  assert.equal(auth.status, 503, 'demo without credentials must not expose a live auth endpoint');

  console.log('PASS: home, menu/cart, catalog, estimate, invalid input, auth disabled.');
} catch (error) {
  console.error(error);
  console.error('Server output:', logs.slice(-5000));
  process.exitCode = 1;
} finally {
  stop();
}
