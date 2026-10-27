import { readFileSync, writeFileSync } from 'node:fs';
const path = process.env.SANDBOX_CI_COUNTER_FILE;
if (process.env.CI !== 'true' || !path) process.exit(12);
let count = 0;
try { count = Number(readFileSync(path, 'utf8')) || 0; } catch { /* first start */ }
count += 1;
writeFileSync(path, String(count));
if (count < 3) process.exit(17);
console.log('SUPERVISOR_FIXTURE_READY');
process.on('SIGTERM', () => process.exit(0));
setInterval(() => undefined, 500);
