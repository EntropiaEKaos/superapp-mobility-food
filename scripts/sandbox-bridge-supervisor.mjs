import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Standalone supervisor for the private sandbox bridge.
 * A single process owns one worker, restarts unexpected exits with backoff.
 * Run this in a managed worker process, never inside Next.js routes.
 */
const CI = process.env.CI === 'true';
const script = CI && process.env.SANDBOX_CI_BRIDGE_SCRIPT
  ? process.env.SANDBOX_CI_BRIDGE_SCRIPT
  : 'scripts/sandbox-redis-bridge.mjs';
const MAX_RESTARTS = 5;
const BACKOFF_MAX_MS = 15_000;
let stopping = false;
let current = null;
let restartCount = 0;
let activeSince = 0;
let stopResolver;
const stopped = new Promise(resolve => { stopResolver = resolve; });

function shutdown() {
  if (stopping) return;
  stopping = true;
  if (current && current.exitCode === null && current.signalCode === null)
    current.kill('SIGTERM');
  stopResolver();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

while (!stopping) {
  activeSince = Date.now();
  current = spawn(process.execPath, [script], {
    env: process.env, stdio: 'inherit',
  });
  console.log('SUPERVISOR_WORKER_STARTED');
  const exit = await new Promise(resolve => {
    current.once('exit', (code, signal) => resolve({ code, signal }));
    current.once('error', () => resolve({ code: 1, signal: null }));
  });
  if (stopping) break;
  if (Date.now() - activeSince >= 60_000) restartCount = 0;
  restartCount += 1;
  if (restartCount > MAX_RESTARTS) {
    console.error('SUPERVISOR_RESTART_LIMIT');
    process.exitCode = 1;
    break;
  }
  const delay = Math.min(BACKOFF_MAX_MS, 500 * 2 ** (restartCount - 1));
  console.error('SUPERVISOR_RESTART', restartCount, delay, exit.code, exit.signal);
  await Promise.race([sleep(delay), stopped]);
}
if (current && current.exitCode === null && current.signalCode === null) {
  current.kill('SIGTERM');
}
