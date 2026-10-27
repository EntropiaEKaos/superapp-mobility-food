import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const dir = mkdtempSync(join(tmpdir(), 'superapp-supervisor-ci-'));
const count = join(dir, 'counter');
const supervisor = spawn(process.execPath, ['scripts/sandbox-bridge-supervisor.mjs'], {
  env: {
    ...process.env, CI: 'true',
    SANDBOX_CI_BRIDGE_SCRIPT: 'scripts/fixtures/sandbox-supervisor-worker.mjs',
    SANDBOX_CI_COUNTER_FILE: count,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
for (const stream of [supervisor.stdout, supervisor.stderr]) {
  stream.on('data', bytes => { output += String(bytes); });
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (output.includes('SUPERVISOR_FIXTURE_READY')) { ready = true; break; }
    if (supervisor.exitCode !== null) break;
    await sleep(100);
  }
  assert.equal(ready, true, 'worker should recover after two failures: ' + output);
  assert.equal(Number(readFileSync(count, 'utf8')), 3);
  assert.equal(output.split('SUPERVISOR_RESTART').length - 1, 2);
  supervisor.kill('SIGTERM');
  for (let i = 0; i < 50 && supervisor.exitCode === null; i++) await sleep(100);
  assert.notEqual(supervisor.exitCode, null, 'supervisor must stop cleanly');
  assert.equal(supervisor.exitCode, 0);
  console.log('PASS: supervisor bounded restarts, recovery and graceful shutdown');
} finally {
  if (supervisor.exitCode === null) supervisor.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
}
