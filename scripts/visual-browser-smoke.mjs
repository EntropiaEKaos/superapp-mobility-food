import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

/** Actual browser testing against the demo build; no DB and no real transactions. */
const base = 'http://127.0.0.1:3192';
const output = 'artifacts/visual-sprint19';
mkdirSync(output, { recursive: true });
const server = spawn('npm', ['run', 'start', '-w', '@superapp/web', '--', '-p', '3192'], {
  env: {
    ...process.env,
    DATABASE_URL: '', BETTER_AUTH_SECRET: '',
    ENABLE_SANDBOX_DISPATCH: 'false',
    BETTER_AUTH_URL: base, NEXT_PUBLIC_APP_URL: base,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});
let logs = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', bytes => { logs += String(bytes); });
const results = [];
const errors = [];
let browser;

async function caseRun(name, task) {
  const started = performance.now();
  try {
    await task();
    results.push({ name, status: 'PASS', ms: Math.round(performance.now() - started) });
  } catch (error) {
    results.push({ name, status: 'FAIL', ms: Math.round(performance.now() - started), message: String(error?.message ?? error).slice(0, 240) });
    throw error;
  }
}
async function waitReady() {
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error('Server exited');
    try {
      if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch { /* booting */ }
    await sleep(200);
  }
  throw new Error('Demo server did not become ready');
}
async function shot(page, name) {
  await page.screenshot({ path: output + '/' + name + '.png', fullPage: true, animations: 'disabled' });
}
async function assertNoHorizontalOverflow(page, name) {
  const dimension = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(dimension.content <= dimension.viewport + 2,
    name + ': horizontal overflow ' + JSON.stringify(dimension));
}
async function safeLink(page, label, path) {
  await page.getByRole('link', { name: label }).first().click();
  await page.waitForURL(url => url.pathname === path);
}
async function checkPublicPages(context, device) {
  const page = await context.newPage();
  const prefix = device + '-';
  page.on('pageerror', err => errors.push(device + ': ' + err.message));
  try {
    await caseRun(device + ' — landing and navigation', async () => {
      await page.goto(base);
      await page.getByRole('heading', { level: 1, name: /Mais cidade/i }).waitFor();
      await assertNoHorizontalOverflow(page, device + ' home');
      await shot(page, prefix + 'home');
      if (device === 'mobile') {
        const dock = page.getByRole('navigation', { name: 'Navegação rápida' });
        assert.equal(await dock.isVisible(), true, 'mobile navigation dock visible');
        for (const label of ['Corridas', 'Delivery', 'Parceiros', 'Conta']) {
          assert.equal(await dock.getByRole('link', { name: label }).isVisible(), true);
        }
        const dockRect = await dock.boundingBox();
        const viewport = page.viewportSize();
        assert.ok(dockRect && viewport && dockRect.y + dockRect.height >= viewport.height - 3);
      }
      await safeLink(page, /Simular corrida/i, '/rides');
    });
    await caseRun(device + ' — ride estimate and invalid same destination', async () => {
      await page.getByRole('heading', { name: /Pra onde vamos/i }).waitFor();
      await page.locator('#destination').selectOption('0');
      assert.equal(await page.getByRole('button', { name: /Calcular estimativa/i }).isDisabled(), true);
      await page.locator('#destination').selectOption('2');
      await page.getByRole('button', { name: /Inverter origem e destino/i }).click();
      await page.getByRole('button', { name: /Inverter origem e destino/i }).click();
      await page.getByRole('button', { name: /Conforto/i }).click();
      await page.getByRole('button', { name: /Calcular estimativa/i }).click();
      await page.getByText(/ESTIMATIVA ILUSTRATIVA/).waitFor();
      assert.ok((await page.locator('.result strong').innerText()).includes('R$'));
      await assertNoHorizontalOverflow(page, device + ' ride');
      await shot(page, prefix + 'rides');
    });
    await caseRun(device + ' — restaurant discovery and demo cart', async () => {
      await page.goto(base + '/food');
      await page.getByRole('heading', { name: /Peça seu próximo favorito/i }).waitFor();
      const finder = page.getByRole('searchbox', { name: /Buscar restaurante ou prato/i });
      await finder.fill('pizza');
      await page.getByText('1 restaurante encontrado').waitFor();
      await finder.fill('inexistente-xyz');
      await page.getByRole('heading', { name: /Nenhum restaurante encontrado/i }).waitFor();
      await page.getByRole('button', { name: /Ver todos os restaurantes/i }).click();
      await page.getByRole('button', { name: 'Lanches' }).click();
      await page.getByText('1 restaurante encontrado').waitFor();
      await page.getByRole('button', { name: /Limpar filtros/i }).click();
      await page.getByText('3 restaurantes encontrados').waitFor();
      await assertNoHorizontalOverflow(page, device + ' food');
      await shot(page, prefix + 'food');
      await page.locator('.restaurant-grid a').first().click();
      await page.getByRole('heading', { name: /Cardápio/ }).waitFor();
      await page.getByText(/Nenhum pedido é enviado ou cobrado/).waitFor();
      await page.getByRole('button', { name: /^Adicionar uma unidade de / }).first().click();
      assert.equal(await page.locator('.sprint21-cart-badge').innerText(), '1');
      const note = page.locator('.menu-item').first().getByRole('textbox', { name: /Observações para/ });
      await note.fill('Sem cebola');
      await page.getByRole('button', { name: /Revisar pedido demo/i }).click();
      const review = page.getByRole('region', { name: /Resumo do pedido demonstrativo/i });
      assert.equal(await review.isVisible(), true);
      await review.getByText(/Sem cebola/).waitFor();
      await review.getByText(/Total ilustrativo: R\\$/).waitFor();
      await page.getByRole('button', { name: /Limpar carrinho/i }).click();
      assert.equal(await review.count(), 0, 'clear closes review');
      await page.getByText(/Seu carrinho está vazio/).waitFor();
      await assertNoHorizontalOverflow(page, device + ' menu');
      await shot(page, prefix + 'menu');
    });
    await caseRun(device + ' — partners and disabled login', async () => {
      await page.goto(base + '/partners');
      await page.getByRole('heading', { name: /Crescer na cidade/i }).waitFor();
      await assertNoHorizontalOverflow(page, device + ' partners');
      await shot(page, prefix + 'partners');
      await page.goto(base + '/login');
      await page.getByText(/Login desabilitado nesta demonstração/).waitFor();
      assert.equal(await page.getByRole('button', { name: /^Entrar$/ }).isDisabled(), true);
      await assertNoHorizontalOverflow(page, device + ' login');
      await shot(page, prefix + 'login');
    });
    await caseRun(device + ' — keyboard-only navigation', async () => {
      await page.goto(base);
      await page.keyboard.press('Tab');
      const first = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        href: document.activeElement?.getAttribute('href'),
      }));
      assert.equal(first.tag, 'A');
      assert.equal(first.href, '#conteudo-principal', 'skip link must be first keyboard target');
      // Mobile nav hides different links: follow focus until a real /rides link
      // instead of assuming a fixed tab index across responsive layouts.
      let focusedRide = false;
      for (let tabIndex = 0; tabIndex < 16; tabIndex++) {
        const target = await page.evaluate(() => document.activeElement?.getAttribute('href'));
        if (target === '/rides') { focusedRide = true; break; }
        await page.keyboard.press('Tab');
      }
      assert.equal(focusedRide, true, 'a ride navigation link must be keyboard reachable');
      await page.keyboard.press('Enter');
      await page.waitForURL(url => url.pathname === '/rides');
      const focused = await page.locator('#origin').getAttribute('id');
      assert.equal(focused, 'origin');
    });
  } finally { await page.close(); }
}
try {
  await waitReady();
  browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR' });
  await checkPublicPages(desktop, 'desktop');
  await desktop.close();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
    isMobile: true, hasTouch: true, locale: 'pt-BR',
  });
  await checkPublicPages(mobile, 'mobile');
  await mobile.close();
  assert.deepEqual(errors, [], 'uncaught browser runtime errors');
} catch (error) {
  console.error('BROWSER_VISUAL_FAILURE', String(error?.stack ?? error).slice(0, 1800));
  console.error('SERVER_LOG_EXCERPT', logs.slice(-800));
  process.exitCode = 1;
} finally {
  const summary = {
    suite: 'sprint19-real-browser',
    browser: 'Chromium',
    renderModes: ['desktop-1440x900', 'mobile-390x844'],
    status: process.exitCode ? 'FAIL' : 'PASS',
    cases: results,
    pageErrors: errors.slice(0, 10),
    productionDeploy: false,
    realTransactions: false,
  };
  writeFileSync(output + '/report.json', JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(output + '/report.md', [
    '# Sprint 19 — Avaliação visual em navegador real',
    '',
    '**Resultado: ' + summary.status + '**',
    '',
    '| Caso | Resultado | Duração (ms) |',
    '| --- | --- | ---: |',
    ...results.map(r => '| ' + r.name + ' | ' + r.status + ' | ' + r.ms + ' |'),
    '',
    'Capturas: home, rides, food, menu, partners e login em desktop e mobile.',
    'Sem deploy, motoristas ou pedidos reais. Checagem de overflow e teclado não substitui auditoria WCAG.',
  ].join('\n'));
  await browser?.close();
  if (server.pid) {
    try {
      if (process.platform === 'win32') server.kill('SIGTERM');
      else process.kill(-server.pid, 'SIGTERM');
    } catch { /* already stopped */ }
  }
  console.log('SPRINT19_VISUAL_REPORT ' + JSON.stringify({
    result: summary.status,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length,
    pageErrors: errors.length,
  }));
}
