/**
 * One-shot external monitor caller. Run under cron or a managed scheduler.
 * Never prints a bearer token or includes it in alert payloads.
 * Optional SANDBOX_ALERT_WEBHOOK_URL receives a sanitized failure notice.
 */
const target = process.env.SANDBOX_MONITOR_URL;
const token = process.env.SANDBOX_MONITOR_TOKEN;
if (!target || !/^https?:\/\//.test(target) || !token || token.length < 32) {
  console.error('MONITOR_CONFIG_ERROR: target URL and 32+ character secret required');
  process.exitCode = 2;
} else {
  let status = 'unhealthy';
  let codes = ['PROBE_UNREACHABLE'];
  let httpStatus = null;
  try {
    const response = await fetch(target, {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(5000), cache: 'no-store',
    });
    httpStatus = response.status;
    const data = await response.json();
    if (response.ok && data?.status === 'healthy' && Array.isArray(data.reasons) &&
        data.reasons.length === 0) {
      status = 'healthy';
      codes = [];
    } else {
      const supported = new Set([
        'OUTBOX_DELAYED', 'OUTBOX_DEAD', 'WORKER_MISSING',
        'REDIS_UNREACHABLE', 'DEPENDENCY_UNAVAILABLE',
      ]);
      codes = Array.isArray(data?.reasons) ?
        data.reasons.filter(code => typeof code === 'string' && supported.has(code)).slice(0, 5) : [];
      if (!codes.length) codes = ['PROBE_BAD_RESPONSE'];
    }
  } catch {
    codes = ['PROBE_UNREACHABLE'];
  }
  const check = {
    component: 'superapp-sandbox',
    status, codes, httpStatus,
    checkedAt: new Date().toISOString(),
  };
  console.log('SANDBOX_MONITOR_RESULT ' + JSON.stringify(check));
  if (status !== 'healthy') {
    process.exitCode = 1;
    if (process.env.SANDBOX_ALERT_WEBHOOK_URL) {
      try {
        const delivered = await fetch(process.env.SANDBOX_ALERT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(check),
          signal: AbortSignal.timeout(4000),
        });
        if (!delivered.ok) throw new Error('Non-2xx alert response');
        console.log('SANDBOX_MONITOR_ALERT_SENT');
      } catch {
        console.error('SANDBOX_MONITOR_ALERT_DELIVERY_FAILED');
      }
    }
  }
}
